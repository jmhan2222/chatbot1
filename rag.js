import { db, storage } from './firebase-config.js';
import {
    collection, addDoc, getDocs, deleteDoc, doc,
    serverTimestamp, query, where, orderBy
} from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js';
import {
    ref, uploadBytes, getDownloadURL, deleteObject
} from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-storage.js';

const CHUNK_SIZE = 500;
const DOCS_COL = 'documents';
const FILES_COL = 'document_files';

// 5분 캐시 (Firestore 읽기 최소화)
let _cache = null;
let _cacheTime = 0;

function invalidateCache() {
    _cache = null;
    _cacheTime = 0;
}

export function splitIntoChunks(text) {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    const chunks = [];
    for (let i = 0; i < cleaned.length; i += CHUNK_SIZE) {
        const chunk = cleaned.slice(i, i + CHUNK_SIZE).trim();
        if (chunk.length > 30) chunks.push(chunk);
    }
    return chunks;
}

export async function uploadAndSave(file, category) {
    // 1. Firebase Storage에 원본 파일 저장
    const storageRef = ref(storage, `documents/${Date.now()}_${file.name}`);
    await uploadBytes(storageRef, file);
    const fileUrl = await getDownloadURL(storageRef);

    // 2. 텍스트 추출
    let text = '';
    if (file.name.toLowerCase().endsWith('.pdf')) {
        text = await extractPdfText(file);
    } else if (file.name.toLowerCase().endsWith('.docx')) {
        text = await extractDocxText(file);
    }
    if (!text.trim()) throw new Error('텍스트를 추출할 수 없습니다. 스캔 이미지 PDF는 지원하지 않습니다.');

    // 3. 청크 분할 후 Firestore documents 컬렉션에 저장
    const chunks = splitIntoChunks(text);
    await Promise.all(chunks.map(chunk =>
        addDoc(collection(db, DOCS_COL), {
            filename: file.name,
            category,
            chunk,
            createdAt: serverTimestamp()
        })
    ));

    // 4. 파일 메타데이터 저장
    await addDoc(collection(db, FILES_COL), {
        filename: file.name,
        category,
        chunkCount: chunks.length,
        fileUrl,
        storagePath: storageRef.fullPath,
        createdAt: serverTimestamp()
    });

    invalidateCache();
    return chunks.length;
}

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
                if (item.chunk?.includes(kw)) score += 2;
                if (item.category?.includes(kw)) score += 1;
                if (item.filename?.includes(kw)) score += 0.5;
            });
            return { ...item, score };
        })
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
}

export async function getAllFiles() {
    const q = query(collection(db, FILES_COL), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function deleteFile(fileMetaId, filename, storagePath) {
    // Firestore chunks 삭제
    const snap = await getDocs(
        query(collection(db, DOCS_COL), where('filename', '==', filename))
    );
    const deletes = snap.docs.map(d => deleteDoc(d.ref));
    deletes.push(deleteDoc(doc(db, FILES_COL, fileMetaId)));

    // Storage 파일 삭제
    if (storagePath) {
        try { await deleteObject(ref(storage, storagePath)); } catch { /* 무시 */ }
    }

    await Promise.all(deletes);
    invalidateCache();
}

async function extractPdfText(file) {
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
    }
    return text;
}

async function extractDocxText(file) {
    if (!window.mammoth) throw new Error('mammoth.js가 로드되지 않았습니다.');
    const result = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value;
}
