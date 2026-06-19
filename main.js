import { manualData } from './data.js';

const CONFIG = {
    GROQ_API_KEY: "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",
    MODEL: "llama-3.1-8b-instant",
    API_URL: "https://api.groq.com/openai/v1/chat/completions"
};

const SYSTEM_PROMPT = `당신은 제주항공 객실훈련팀 AI 어시스턴트입니다.

핵심 원칙:
- 제공된 교범 내용만 기반으로 답변
- 교범에 없으면 절대 추측 금지
- 이전 대화 맥락을 반드시 고려해서 답변
- 질문이 모호하면 한 번만 명확하게 되물어보기
- 되물을 때는 가장 핵심적인 것 하나만 질문
- 이미 되물었다면 가진 정보로 최선을 다해 답변
- 안전/비상 관련은 항상 정확하고 진지하게
- 교범에 없으면: '해당 내용은 교범에서 확인되지 않아요. 담당 부서에 문의해주세요.'`;

class ChatApp {
    constructor() {
        this.chatContainer = document.getElementById('chat-container');
        this.userInput = document.getElementById('user-input');
        this.sendBtn = document.getElementById('send-btn');
        this.apiKey = CONFIG.GROQ_API_KEY;
        this.isTyping = false;

        // 최근 5쌍(10개) 대화 히스토리 — Groq messages 배열로 전달
        this.conversationHistory = [];
        // 카테고리 버튼 클릭 시 세팅, 직접 입력 수정 시 해제
        this.pendingCategoryName = null;

        this.init();
    }

    init() {
        this.sendBtn.addEventListener('click', () => this.handleSend());
        this.userInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleSend();
        });

        document.querySelectorAll('.cat-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.userInput.value = btn.dataset.query;
                this.pendingCategoryName = btn.textContent.trim();
                this.userInput.focus();
            });
        });

        // 사용자가 직접 텍스트 수정 시 카테고리 플래그 해제
        this.userInput.addEventListener('input', () => {
            this.pendingCategoryName = null;
        });

        this.userInput.focus();
    }

    async handleSend() {
        const text = this.userInput.value.trim();
        if (!text || this.isTyping) return;

        this.isTyping = true;
        this.sendBtn.disabled = true;
        this.appendMessage('user', text);
        this.userInput.value = '';
        this.userInput.disabled = true;

        let loading;
        try {
            // ── 카테고리 버튼 클릭 → 검색 없이 안내만 ──────────────────
            if (this.pendingCategoryName) {
                const catName = this.pendingCategoryName;
                this.pendingCategoryName = null;
                this.appendMessage('bot', `${catName}에 대해 궁금한 점을 구체적으로 질문해주세요 😊`);
                return;
            }

            loading = this.showLoading();
            const lt = () => loading?.querySelector('.loading-text');

            // ── 1단계: 검색 키워드 추출 ──────────────────────────────────
            const setLt = msg => { const el = lt(); if (el) el.textContent = msg; };
            setLt('질문을 분석하고 있습니다...');
            const keywords = await this.extractKeywords(text);

            // ── 2단계: 키워드로 청크 검색 ────────────────────────────────
            setLt('교범을 검색하고 있습니다...');
            let chunks = await this.searchByKeywords(keywords);

            // ── 3단계: Groq로 관련성 필터링 ──────────────────────────────
            if (chunks.length > 1) {
                setLt('관련 내용을 확인하고 있습니다...');
                chunks = await this.filterRelevantChunks(text, chunks);
            }

            // ── 4단계: 히스토리 + 컨텍스트로 최종 답변 ──────────────────
            setLt('답변을 생성하고 있습니다...');
            const context = chunks.join('\n\n');
            const messages = this.buildMessages(text, context);
            const answer = await this.callGroqWithRetry(messages, loading);

            if (loading) loading.remove();
            this.appendMessage('bot', answer);

            // 히스토리 추가 — 최근 5쌍(10개) 유지
            this.conversationHistory.push(
                { role: 'user',      content: text },
                { role: 'assistant', content: answer }
            );
            if (this.conversationHistory.length > 10) {
                this.conversationHistory = this.conversationHistory.slice(-10);
            }

        } catch (error) {
            console.error("Chat Error:", error);
            if (loading) loading.remove();

            let errorMsg = "죄송합니다. 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
            if (error.message?.includes("API_KEY_INVALID") || error.message?.includes("API key not valid")) {
                errorMsg = "API 키가 유효하지 않습니다. 관리자에게 문의하세요.";
            } else if (error.status === 429 || error.message?.includes("quota")) {
                const waitSec = error.retryAfter ?? 15;
                errorMsg = `API 요청 한도를 초과했습니다. **${waitSec}초 후** 다시 시도해주세요.`;
            } else if (error.name === "TypeError" || error.message?.includes("fetch")) {
                errorMsg = "네트워크 연결을 확인해주세요.";
            }

            this.appendMessage('bot', errorMsg);
        } finally {
            this.isTyping = false;
            this.sendBtn.disabled = false;
            this.userInput.disabled = false;
            this.userInput.focus();
            this.scrollToBottom();
        }
    }

    // 1단계: 대화 맥락 고려해서 검색 키워드 추출
    async extractKeywords(query) {
        const recentCtx = this.conversationHistory.slice(-4)
            .map(m => `${m.role === 'user' ? '사용자' : '어시스턴트'}: ${m.content.slice(0, 100)}`)
            .join('\n');

        const prompt = recentCtx
            ? `대화 맥락:\n${recentCtx}\n\n현재 질문: "${query}"\n\n위 맥락을 고려해서 현재 질문의 핵심 검색 키워드 1~3개만 공백으로 구분해서 출력해줘. 다른 텍스트 없이:`
            : `질문: "${query}"\n\n핵심 검색 키워드 1~3개만 공백으로 구분해서 출력해줘. 다른 텍스트 없이:`;

        try {
            const raw = await this.rawGroqCall(prompt, 30);
            const keywords = raw.trim().split(/\s+/).filter(k => k.length > 0);
            return keywords.length > 0 ? keywords : [query];
        } catch {
            return [query]; // 실패 시 원문으로 폴백
        }
    }

    // 2단계: 키워드로 manualData + Firestore 검색
    async searchByKeywords(keywords) {
        // Firestore RAG 시도
        try {
            const { searchChunks } = await import('./rag.js');
            const ragChunks = await searchChunks(keywords.join(' '));
            if (ragChunks.length > 0) {
                return ragChunks.map(c => `[출처: ${c.filename}]\n${c.chunk}`);
            }
        } catch { /* Firebase 미설정 시 무시 */ }

        // data.js 폴백 — 키워드 포함 여부로 점수화
        const scored = manualData.map(item => {
            let score = 0;
            keywords.forEach(kw => {
                item.keywords.forEach(k => {
                    if (k.includes(kw) || kw.includes(k)) score += 2;
                });
                if (item.text.includes(kw)) score += 3;
                if (item.category.includes(kw)) score += 1;
            });
            return { ...item, score };
        }).filter(item => item.score > 0);

        scored.sort((a, b) =>
            b.score - a.score || (a.source || '').localeCompare(b.source || '')
        );

        return scored.slice(0, 6).map(item => `[출처: ${item.source}]\n${item.text}`);
    }

    // 3단계: Groq로 관련성 배치 필터링
    async filterRelevantChunks(query, chunks) {
        const chunkList = chunks
            .map((c, i) => `[${i}] ${c.slice(0, 300)}`)
            .join('\n\n');

        const prompt = `질문: "${query}"\n\n아래 청크들 중 질문과 관련 있는 번호만 JSON 배열로 답해줘. 없으면 []:\n${chunkList}`;

        try {
            const raw = await this.rawGroqCall(prompt, 50);
            const match = raw.match(/\[[\d,\s]*\]/);
            if (!match) return chunks;

            const indices = JSON.parse(match[0])
                .map(Number)
                .filter(i => !isNaN(i) && i >= 0 && i < chunks.length);

            return indices.length > 0 ? indices.map(i => chunks[i]) : chunks;
        } catch {
            return chunks; // 실패 시 전체 유지
        }
    }

    // messages 배열 구성 — 시스템 프롬프트 + 히스토리 + 현재 질문
    buildMessages(currentQuery, context) {
        const systemContent = `${SYSTEM_PROMPT}

[교범 내용]: ${context || '(관련 교범 내용 없음)'}`;

        return [
            { role: 'system', content: systemContent },
            ...this.conversationHistory.slice(-8), // 최근 4쌍
            { role: 'user', content: currentQuery }
        ];
    }

    // 경량 Groq 호출 (키워드 추출 / 관련성 필터링용)
    async rawGroqCall(prompt, maxTokens = 100) {
        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify({
                model: CONFIG.MODEL,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: maxTokens,
                temperature: 0
            })
        });
        if (!response.ok) throw new Error(`rawGroqCall HTTP ${response.status}`);
        const data = await response.json();
        return data.choices?.[0]?.message?.content ?? '';
    }

    // 429 재시도 포함 메인 Groq 호출
    async callGroqWithRetry(messages, loading) {
        const callOnce = async () => {
            const response = await fetch(CONFIG.API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: CONFIG.MODEL,
                    messages,
                    max_tokens: 1024,
                    temperature: 0,
                    seed: 0
                })
            });

            const retryAfter  = response.headers.get('retry-after');
            const resetReq    = response.headers.get('x-ratelimit-reset-requests');
            console.log(`[Groq] status=${response.status}`);

            if (!response.ok) {
                let errorData;
                try { errorData = await response.json(); } catch { }
                const err = new Error(errorData?.error?.message || `API 호출 실패 (HTTP ${response.status})`);
                err.status = response.status;
                const rawRetry = retryAfter || resetReq;
                if (rawRetry) {
                    const secs = parseFloat(rawRetry.replace(/[^0-9.]/g, ''));
                    if (!isNaN(secs)) err.retryAfter = Math.ceil(secs);
                }
                throw err;
            }

            const data = await response.json();
            const text = data.choices?.[0]?.message?.content;
            if (!text) throw new Error("응답 데이터 구조가 올바르지 않습니다.");
            return text;
        };

        try {
            return await callOnce();
        } catch (firstError) {
            if (firstError.status === 429) {
                const waitSec = firstError.retryAfter ?? 15;
                console.warn(`[Groq] 429 → ${waitSec}초 후 재시도`);
                const lt = loading?.querySelector('.loading-text');
                if (lt) lt.textContent = `${waitSec}초 후 자동으로 재시도합니다 ⏳`;
                await new Promise(r => setTimeout(r, waitSec * 1000));
                return await callOnce();
            }
            throw firstError;
        }
    }

    appendMessage(role, text) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('ko-KR', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });

        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${role}`;

        const formattedText = text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n---\n/g, '<hr>')
            .replace(/\n/g, '<br>');

        if (role === 'bot') {
            msgDiv.innerHTML = `
                <div class="avatar"><i class="fas fa-plane-departure"></i></div>
                <div class="msg-content">
                    <div class="bubble">${formattedText}</div>
                    <div class="timestamp">${timeStr}</div>
                </div>
            `;
        } else {
            msgDiv.innerHTML = `
                <div class="msg-content">
                    <div class="bubble">${formattedText}</div>
                    <div class="timestamp">${timeStr}</div>
                </div>
            `;
        }

        this.chatContainer.appendChild(msgDiv);
        this.scrollToBottom();
    }

    showLoading() {
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'message bot loading-container';
        loadingDiv.innerHTML = `
            <div class="avatar"><i class="fas fa-plane-departure"></i></div>
            <div class="msg-content">
                <div class="bubble loading-bubble">
                    <div class="loading">
                        <div class="dot"></div>
                        <div class="dot"></div>
                        <div class="dot"></div>
                    </div>
                    <span class="loading-text">답변을 생성하고 있습니다...</span>
                </div>
            </div>
        `;
        this.chatContainer.appendChild(loadingDiv);
        this.scrollToBottom();
        return loadingDiv;
    }

    scrollToBottom() {
        this.chatContainer.scrollTo({
            top: this.chatContainer.scrollHeight,
            behavior: 'smooth'
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new ChatApp();
});
