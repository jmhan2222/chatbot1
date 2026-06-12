// auth만 정적 import — rag.js 로딩 실패가 로그인에 영향을 주지 않도록 분리
import { auth } from './firebase-config.js';
import {
    signInWithEmailAndPassword, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js';

// rag.js는 로그인 후 필요할 때만 동적 로드
let _rag = null;
async function getRag() {
    if (!_rag) _rag = await import('./rag.js');
    return _rag;
}

// ── 디버그 패널 ───────────────────────────────────────────────────────────────

function dbg(id, msg) {
    const el = document.getElementById(id);
    if (el) el.textContent = msg;
}

// SDK 로딩 확인
dbg('dbg-sdk', `✅ Firebase SDK 10.14.0 로드됨`);

// Auth 상태 실시간 반영
onAuthStateChanged(auth, user => {
    if (user) {
        dbg('dbg-auth', `✅ 로그인됨: ${user.email}`);
        showAdmin();
        loadDocuments();
    } else {
        dbg('dbg-auth', `ℹ️ 로그아웃 상태`);
        showLogin();
    }
}, err => {
    dbg('dbg-auth', `❌ Auth 오류: ${err.code}`);
    console.error('[Auth State Error]', err);
});

document.getElementById('debug-btn').addEventListener('click', async () => {
    const btn = document.getElementById('debug-btn');
    btn.textContent = '테스트 중...';
    btn.disabled = true;
    try {
        // Auth 프로젝트 접근 가능 여부 확인 (존재하지 않는 계정으로 시도)
        await signInWithEmailAndPassword(auth, 'debug-test@test.com', 'wrongpass');
    } catch (err) {
        if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
            dbg('dbg-auth', `✅ Firebase Auth 정상 연결 (코드: ${err.code})`);
        } else {
            dbg('dbg-auth', `❌ 연결 오류: ${err.code}`);
            console.error('[Debug Test]', err);
        }
    } finally {
        btn.textContent = '연결 테스트';
        btn.disabled = false;
    }
});

// ── Auth ──────────────────────────────────────────────────────────────────────

function showLogin() {
    document.getElementById('login-section').classList.remove('hidden');
    document.getElementById('admin-section').classList.add('hidden');
    const btn = document.getElementById('login-btn');
    btn.disabled = false;
    btn.textContent = '로그인';
}

function showAdmin() {
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('admin-section').classList.remove('hidden');
}

document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn   = document.getElementById('login-btn');
    const errEl = document.getElementById('login-error');
    const email = document.getElementById('email').value.trim();
    const pw    = document.getElementById('password').value;

    btn.disabled    = true;
    btn.textContent = '로그인 중...';
    errEl.textContent = '';

    console.log('[Login] 시도:', email);

    try {
        const cred = await signInWithEmailAndPassword(auth, email, pw);
        console.log('[Login] 성공:', cred.user.email);
    } catch (err) {
        console.error('[Login Error]', err.code, err.message);
        const messages = {
            'auth/invalid-credential':     '이메일 또는 비밀번호가 올바르지 않습니다.',
            'auth/user-not-found':         '등록된 이메일이 없습니다.',
            'auth/wrong-password':         '비밀번호가 올바르지 않습니다.',
            'auth/invalid-email':          '이메일 형식이 올바르지 않습니다.',
            'auth/user-disabled':          '비활성화된 계정입니다.',
            'auth/too-many-requests':      '시도 횟수 초과. 잠시 후 다시 시도하세요.',
            'auth/network-request-failed': '네트워크 오류. 인터넷 연결을 확인하세요.',
            'auth/api-key-not-valid.-please-pass-a-valid-api-key.':
                                           'Firebase API 키가 유효하지 않습니다.',
        };
        errEl.textContent = (messages[err.code] ?? '알 수 없는 오류') + ` [${err.code}]`;
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
        const { saveChunks } = await getRag();
        const total = await saveChunks(file, category, (saved, t) => setProgress(saved, t, file.name));
        setStatus('success', `✅ "${file.name}" 저장 완료 — ${total}개 청크`);
        loadDocuments();
    } catch (err) {
        console.error(err);
        setStatus('error', `업로드 실패: ${err.message}`);
    }
}

function setStatus(type, msg) {
    const el = document.getElementById('upload-status');
    el.className = `upload-status ${type}`;
    el.innerHTML = type === 'loading' ? `<i class="fas fa-spinner fa-spin"></i> ${msg}` : msg;
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
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        <span class="progress-pct">${pct}%</span>
    `;
}

// ── 텍스트 직접 입력 ──────────────────────────────────────────────────────────

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
        const { saveTextChunks } = await getRag();
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
    el.innerHTML = type === 'loading' ? `<i class="fas fa-spinner fa-spin"></i> ${msg}` : msg;
    el.classList.remove('hidden');
}

// ── Document List ─────────────────────────────────────────────────────────────

async function loadDocuments() {
    const list = document.getElementById('doc-list');
    list.innerHTML = '<div class="list-loading"><i class="fas fa-spinner fa-spin"></i></div>';
    try {
        const { getAllFiles } = await getRag();
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
                <button class="btn-delete" data-id="${f.id}" data-filename="${f.filename}">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `).join('');
        list.querySelectorAll('.btn-delete').forEach(btn => btn.addEventListener('click', handleDelete));
    } catch (err) {
        list.innerHTML = `<p class="empty-msg error">목록 로드 실패: ${err.message}</p>`;
    }
}

async function handleDelete(e) {
    if (!confirm('이 문서와 관련된 모든 청크를 삭제하시겠습니까?')) return;
    const btn = e.currentTarget;
    const { id, filename } = btn.dataset;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    try {
        const { deleteFile } = await getRag();
        await deleteFile(id, filename);
        loadDocuments();
    } catch {
        btn.disabled  = false;
        btn.innerHTML = '<i class="fas fa-trash"></i>';
        alert('삭제 실패. 다시 시도해주세요.');
    }
}
