import { db } from './firebase-config.js';
import {
    collection, addDoc, getDocs, deleteDoc,
    serverTimestamp, query, where, orderBy, writeBatch, doc
} from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js';

const CHUNK_SIZE = 500;
const DOCS_COL   = 'documents';
const FILES_COL  = 'document_files';

// 5분 캐시 (Firestore 읽기 최소화)
let _cache = null;
let _cacheTime = 0;

function invalidateCache() { _cache = null; _cacheTime = 0; }

// ── 텍스트 추출 ────────────────────────────────────────────────────────────────

export async function extractText(file, onPageProgress) {
    if (file.name.toLowerCase().endsWith('.pdf')) {
        return extractPdfText(file, onPageProgress);
    } else if (file.name.toLowerCase().endsWith('.docx')) {
        return extractDocxText(file);
    }
    throw new Error('PDF 또는 .docx 파일만 지원합니다.');
}

async function extractPdfText(file, onPageProgress) {
    const { getDocument, GlobalWorkerOptions } = await import(
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.min.mjs'
    );
    GlobalWorkerOptions.workerSrc =
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.worker.min.mjs';

    const pdf = await getDocument({ data: await file.arrayBuffer() }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(item => item.str).join(' ') + '\n';
        if (onPageProgress) onPageProgress(i, pdf.numPages);
    }
    return text;
}

async function extractDocxText(file) {
    if (!window.mammoth) throw new Error('mammoth.js가 로드되지 않았습니다.');
    const result = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value;
}

// ── 청크 분할 ──────────────────────────────────────────────────────────────────

export function splitIntoChunks(text) {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (!cleaned) return [];
    const chunks = [];
    for (let i = 0; i < cleaned.length; i += CHUNK_SIZE) {
        const chunk = cleaned.slice(i, i + CHUNK_SIZE).trim();
        if (chunk.length > 0) chunks.push(chunk);
    }
    return chunks;
}

// ── Firestore 저장 (진행률 콜백 지원) ─────────────────────────────────────────

export async function saveChunks(file, category, onChunkProgress, onPageProgress) {
    const text = await extractText(file, onPageProgress);
    if (!text.trim()) throw new Error('텍스트를 추출할 수 없습니다. 스캔 이미지 PDF는 지원하지 않습니다.');

    const chunks = splitIntoChunks(text);
    if (chunks.length === 0) throw new Error('텍스트를 추출할 수 없습니다. 스캔 이미지 PDF는 지원하지 않습니다.');
    const total = chunks.length;

    for (let i = 0; i < total; i++) {
        await addDoc(collection(db, DOCS_COL), {
            filename:   file.name,
            category,
            content:    chunks[i],
            chunk:      chunks[i],
            chunkIndex: i,
            createdAt:  serverTimestamp()
        });
        if (onChunkProgress) onChunkProgress(i + 1, total);
    }

    await addDoc(collection(db, FILES_COL), {
        filename:   file.name,
        category,
        chunkCount: total,
        createdAt:  serverTimestamp()
    });

    invalidateCache();
    return total;
}

// ── 텍스트 직접 저장 ──────────────────────────────────────────────────────────

export async function saveTextChunks(title, category, text, onProgress) {
    const trimmed = text.trim();
    if (!trimmed) throw new Error('내용을 입력해주세요.');

    const chunks = splitIntoChunks(trimmed);
    if (chunks.length === 0) throw new Error('저장할 내용이 너무 짧습니다. 내용을 더 입력해주세요.');
    const total  = chunks.length;

    console.log('[saveTextChunks] 청크 수:', total, '| 첫 청크 미리보기:', chunks[0]?.slice(0, 50));

    for (let i = 0; i < total; i++) {
        await addDoc(collection(db, DOCS_COL), {
            filename:   title,
            category,
            content:    chunks[i],   // content 필드명으로 저장
            chunk:      chunks[i],   // 검색 호환성 유지
            chunkIndex: i,
            createdAt:  serverTimestamp()
        });
        if (onProgress) onProgress(i + 1, total);
    }

    await addDoc(collection(db, FILES_COL), {
        filename:   title,
        category,
        chunkCount: total,
        createdAt:  serverTimestamp()
    });

    invalidateCache();
    return total;
}

// ── 검색 ───────────────────────────────────────────────────────────────────────

export async function searchChunks(userQuery) {
    const now = Date.now();
    if (!_cache || now - _cacheTime > 5 * 60 * 1000) {
        const snap = await getDocs(collection(db, DOCS_COL));
        _cache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        _cacheTime = now;
    }

    const keywords = userQuery
        .replace(/[^\w가-힣\s]/g, '')
        .split(/\s+/)
        .filter(k => k.length > 1);

    if (!keywords.length) return [];

    return _cache
        .map(item => {
            let score = 0;
            keywords.forEach(kw => {
                if (item.chunk?.includes(kw))     score += 2;
                if (item.category?.includes(kw))  score += 1;
                if (item.filename?.includes(kw))  score += 0.5;
            });
            return { ...item, score };
        })
        .filter(item => item.score >= 2)   // 청크 본문에 최소 1개 키워드 일치 필요
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
}

// ── 목록 조회 / 삭제 ──────────────────────────────────────────────────────────

export async function getAllFiles() {
    const q = query(collection(db, FILES_COL), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function deleteFile(fileMetaId, filename) {
    // documents 컬렉션에서 해당 파일의 모든 청크 삭제
    const snap = await getDocs(
        query(collection(db, DOCS_COL), where('filename', '==', filename))
    );

    // Firestore writeBatch 최대 500건 제한 대응
    const batchSize = 400;
    for (let i = 0; i < snap.docs.length; i += batchSize) {
        const batch = writeBatch(db);
        snap.docs.slice(i, i + batchSize).forEach(d => batch.delete(d.ref));
        await batch.commit();
    }

    // 파일 메타데이터 삭제
    await deleteDoc(doc(db, FILES_COL, fileMetaId));
    invalidateCache();
}
