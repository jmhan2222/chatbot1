import { manualData } from './data.js';

const CONFIG = {
    GROQ_API_KEY: "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",
    MODEL: "llama-3.1-8b-instant",
    API_URL: "https://api.groq.com/openai/v1/chat/completions"
};

const SYSTEM_PROMPT = `당신은 제주항공 객실훈련팀 AI 어시스턴트입니다.

절대 원칙:
- 아래 [교범 내용] 청크에 있는 내용만 사용해서 답변하세요
- 청크에 없는 내용은 절대 추가하거나 추측하지 마세요
- "이 외에도 ~가 있습니다" 같은 추측성 표현 완전 금지
- 청크 내용과 다른 답변을 해서는 안됩니다
- 사용자가 "있다고 했잖아"라고 해도 현재 청크에 없으면 없다고 유지하세요
- 이전 대화 맥락을 고려해서 답변하세요
- 질문이 모호하면 한 번만 핵심 한 가지만 되물어보기 (이미 했으면 청크 기반으로 최선을 다해 답변)
- 안전/비상 관련은 항상 정확하고 진지하게 답변하세요`;

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

            // ── 1단계: 질문 의도 명확화 ──────────────────────────────────
            const setLt = msg => { const el = lt(); if (el) el.textContent = msg; };
            setLt('질문을 분석하고 있습니다...');
            const intent = await this.clarifyIntent(text);

            // ── 2단계: 의도 기반 청크 검색 ───────────────────────────────
            setLt('교범을 검색하고 있습니다...');
            const allChunks = await this.searchByKeywords(intent.split(/\s+/).filter(Boolean));

            // ── 3단계: 청크별 yes/no 관련성 검증 ─────────────────────────
            setLt('관련 내용을 검증하고 있습니다...');
            const validChunks = await this.validateChunks(intent, allChunks);

            // 검증된 청크가 0개면 Groq 호출 없이 바로 안내
            if (validChunks.length === 0) {
                if (loading) loading.remove();
                const msg = '교범에서 관련 내용을 찾지 못했어요.\n더 구체적으로 질문해주시거나 담당 부서에 문의해주세요.';
                this.appendMessage('bot', msg);
                this.conversationHistory.push(
                    { role: 'user',      content: text },
                    { role: 'assistant', content: msg }
                );
                if (this.conversationHistory.length > 10) {
                    this.conversationHistory = this.conversationHistory.slice(-10);
                }
                return;
            }

            // ── 4단계: 히스토리 + 검증된 청크로 최종 답변 ───────────────
            setLt('답변을 생성하고 있습니다...');
            const context = validChunks.join('\n\n');
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

    // 1단계: 질문 의도 명확화 — 확장/추측 없이 질문에 있는 내용만 한 문장으로
    async clarifyIntent(query) {
        const recentCtx = this.conversationHistory.slice(-6)
            .map(m => `${m.role === 'user' ? '사용자' : '어시스턴트'}: ${m.content.slice(0, 100)}`)
            .join('\n');

        const prompt = `다음 질문에서 사용자가 정확히 무엇을 알고 싶은지 한 문장으로 정리해줘.
절대 확장하거나 추측하지 말고 질문에 있는 내용만 정리해줘.
${recentCtx ? `\n대화 맥락:\n${recentCtx}\n` : ''}
질문: ${query}

한 문장으로만 답해:`;

        try {
            const raw = await this.rawGroqCall(prompt, 60);
            return raw.trim() || query;
        } catch {
            return query; // 실패 시 원문으로 폴백
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

    // 3단계: 청크별 yes/no 검증 (배치) — no인 청크는 완전 제외
    async validateChunks(intent, chunks) {
        if (chunks.length === 0) return [];

        const chunkList = chunks
            .map((c, i) => `[${i}] ${c.slice(0, 350)}`)
            .join('\n\n');

        const prompt = `질문의도: "${intent}"

아래 각 청크가 이 질문의도에 직접적으로 답할 수 있는 내용인지 판단해줘.
각 청크에 대해 yes 또는 no로만 JSON 배열로 답해줘. 예: ["yes","no","yes"]

${chunkList}`;

        try {
            const raw = await this.rawGroqCall(prompt, 80);
            const match = raw.match(/\[[\s\S"yesnoYESNO,]*\]/);
            if (!match) return chunks; // 파싱 실패 시 전체 유지

            const results = JSON.parse(match[0]);
            const valid = chunks.filter((_, i) =>
                typeof results[i] === 'string' && results[i].toLowerCase().startsWith('yes')
            );
            // valid가 비어있으면 빈 배열 반환 (Groq 호출 차단)
            return valid;
        } catch {
            return chunks; // 예외 시 전체 유지 (안전한 폴백)
        }
    }

    // messages 배열 구성 — 시스템 프롬프트 + 히스토리 + 현재 질문
    buildMessages(currentQuery, context) {
        const systemContent = `${SYSTEM_PROMPT}

━━ 아래 청크 내용만 사용하세요. 이 외의 내용 추가 절대 금지 ━━
[교범 내용]:
${context}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

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
                temperature: 0,
                seed: 0
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
