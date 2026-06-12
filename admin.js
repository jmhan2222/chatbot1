import { auth } from './firebase-config.js';
import {
    signInWithEmailAndPassword, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js';
import { uploadAndSave, getAllFiles, deleteFile } from './rag.js';

// ── Auth ─────────────────────────────────────────────────────────────────────

onAuthStateChanged(auth, user => {
    document.getElementById('login-section').classList.toggle('hidden', !!user);
    document.getElementById('admin-section').classList.toggle('hidden', !user);
    if (user) loadDocuments();
});

document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('login-btn');
    const errEl = document.getElementById('login-error');
    btn.disabled = true;
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
        btn.disabled = false;
        btn.textContent = '로그인';
    }
});

document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));

// ── File Upload ───────────────────────────────────────────────────────────────

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
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
        const count = await uploadAndSave(file, category);
        setStatus('success', `✅ "${file.name}" 업로드 완료 (${count}개 청크 저장)`);
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
                    data-filename="${f.filename}"
                    data-path="${f.storagePath || ''}">
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
    const btn = e.currentTarget;
    const { id, filename, path } = btn.dataset;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    try {
        await deleteFile(id, filename, path);
        loadDocuments();
    } catch {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-trash"></i>';
        alert('삭제 실패. 다시 시도해주세요.');
    }
}
