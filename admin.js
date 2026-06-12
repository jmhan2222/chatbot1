import { auth } from './firebase-config.js';
import {
    signInWithEmailAndPassword, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js';
import { saveChunks, saveTextChunks, getAllFiles, deleteFile } from './rag.js';

// ── Auth ──────────────────────────────────────────────────────────────────────

onAuthStateChanged(auth, user => {
    document.getElementById('login-section').classList.toggle('hidden', !!user);
    document.getElementById('admin-section').classList.toggle('hidden', !user);
    if (user) loadDocuments();
});

document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn   = document.getElementById('login-btn');
    const errEl = document.getElementById('login-error');
    btn.disabled    = true;
    btn.textContent = '로그인 중...';
    errEl.textContent = '';
    try {
        await signInWithEmailAndPassword(
            auth,
            document.getElementById('email').value,
            document.getElementById('password').value
        );
    } catch {
        errEl.textContent = '이메일 또는 비밀번호가 올바르지 않습니다.';
        btn.disabled    = false;
        btn.textContent = '로그인';
    }
});

document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));

// ── File Upload ───────────────────────────────────────────────────────────────

const dropZone  = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', e => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
    fileInput.value = '';
});

async function handleFile(file) {
    if (!/\.(pdf|docx)$/i.test(file.name)) {
        setStatus('error', 'PDF 또는 .docx 파일만 업로드 가능합니다.');
        return;
    }

    const category = document.getElementById('category-select').value;
    setStatus('loading', `"${file.name}" 텍스트 추출 중...`);

    try {
        const total = await saveChunks(file, category, (saved, t) => {
            setProgress(saved, t, file.name);
        });
        setStatus('success', `✅ "${file.name}" 저장 완료 — ${total}개 청크가 Firestore에 저장됐습니다.`);
        loadDocuments();
    } catch (err) {
        console.error(err);
        setStatus('error', `업로드 실패: ${err.message}`);
    }
}

function setStatus(type, msg) {
    const el = document.getElementById('upload-status');
    el.className = `upload-status ${type}`;
    el.innerHTML = type === 'loading'
        ? `<i class="fas fa-spinner fa-spin"></i> ${msg}`
        : msg;
    el.classList.remove('hidden');
}

function setProgress(saved, total, filename) {
    const pct = Math.round((saved / total) * 100);
    const el  = document.getElementById('upload-status');
    el.className = 'upload-status loading';
    el.classList.remove('hidden');
    el.innerHTML = `
        <div class="progress-header">
            <i class="fas fa-spinner fa-spin"></i>
            <span>"${filename}" — 청크 <strong>${saved}</strong> / ${total} 저장 중...</span>
        </div>
        <div class="progress-track">
            <div class="progress-fill" style="width: ${pct}%"></div>
        </div>
        <span class="progress-pct">${pct}%</span>
    `;
}

// ── 텍스트 직접 입력 ─────────────────────────────────────────────────────────

document.getElementById('manual-save-btn').addEventListener('click', async () => {
    const title    = document.getElementById('manual-title').value.trim();
    const category = document.getElementById('manual-category').value;
    const content  = document.getElementById('manual-content').value.trim();

    if (!title || !content) {
        setManualStatus('error', '제목과 내용을 모두 입력해주세요.');
        return;
    }

    const btn = document.getElementById('manual-save-btn');
    btn.disabled = true;

    try {
        const total = await saveTextChunks(title, category, content, (saved, t) => {
            setManualStatus('loading', `청크 <strong>${saved}</strong> / ${t} 저장 중...`);
        });
        setManualStatus('success', `✅ "${title}" 저장 완료 — ${total}개 청크`);
        document.getElementById('manual-title').value   = '';
        document.getElementById('manual-content').value = '';
        loadDocuments();
    } catch (err) {
        console.error(err);
        setManualStatus('error', `저장 실패: ${err.message}`);
    } finally {
        btn.disabled = false;
    }
});

function setManualStatus(type, msg) {
    const el = document.getElementById('manual-status');
    el.className = `upload-status ${type}`;
    el.innerHTML = type === 'loading'
        ? `<i class="fas fa-spinner fa-spin"></i> ${msg}`
        : msg;
    el.classList.remove('hidden');
}

// ── Document List ─────────────────────────────────────────────────────────────

async function loadDocuments() {
    const list = document.getElementById('doc-list');
    list.innerHTML = '<div class="list-loading"><i class="fas fa-spinner fa-spin"></i></div>';
    try {
        const files = await getAllFiles();
        if (!files.length) {
            list.innerHTML = '<p class="empty-msg">업로드된 문서가 없습니다.</p>';
            return;
        }
        list.innerHTML = files.map(f => `
            <div class="doc-item">
                <div class="doc-info">
                    <i class="fas ${/\.pdf$/i.test(f.filename) ? 'fa-file-pdf' : 'fa-file-word'} doc-icon"></i>
                    <div>
                        <p class="doc-name">${f.filename}</p>
                        <p class="doc-meta">
                            <span class="badge">${f.category}</span>
                            ${f.chunkCount}개 청크
                        </p>
                    </div>
                </div>
                <button class="btn-delete"
                    data-id="${f.id}"
                    data-filename="${f.filename}">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `).join('');

        list.querySelectorAll('.btn-delete').forEach(btn =>
            btn.addEventListener('click', handleDelete)
        );
    } catch (err) {
        list.innerHTML = `<p class="empty-msg error">목록 로드 실패: ${err.message}</p>`;
    }
}

async function handleDelete(e) {
    if (!confirm('이 문서와 관련된 모든 청크를 삭제하시겠습니까?')) return;
    const btn      = e.currentTarget;
    const { id, filename } = btn.dataset;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    try {
        await deleteFile(id, filename);
        loadDocuments();
    } catch {
        btn.disabled  = false;
        btn.innerHTML = '<i class="fas fa-trash"></i>';
        alert('삭제 실패. 다시 시도해주세요.');
    }
}
