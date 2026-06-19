import { manualData } from './data.js';

const CONFIG = {
    GROQ_API_KEY: "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",
    MODEL: "llama-3.1-8b-instant",
    API_URL: "https://api.groq.com/openai/v1/chat/completions"
};

class ChatApp {
    constructor() {
        this.chatContainer = document.getElementById('chat-container');
        this.userInput = document.getElementById('user-input');
        this.sendBtn = document.getElementById('send-btn');
        this.apiKey = CONFIG.GROQ_API_KEY;
        this.isTyping = false;

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
                this.userInput.focus();
            });
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
            loading = this.showLoading();

            // Firestore RAG 검색 → 없으면 data.js 폴백
            let context = '';
            try {
                const { searchChunks } = await import('./rag.js');
                const chunks = await searchChunks(text);
                if (chunks.length > 0) {
                    context = chunks.map(c => `[출처: ${c.filename}]\n${c.chunk}`).join('\n\n');
                }
            } catch { /* Firebase 미설정 시 무시 */ }
            if (!context) context = this.findRelevantContext(text);

            if (!context) {
                if (loading) loading.remove();
                this.appendMessage('bot', '해당 내용은 교범에서 확인되지 않아요.\n담당 부서에 직접 문의해주세요.');
                return;
            }

            let answer;
            try {
                answer = await this.getGroqResponse(text, context);
            } catch (firstError) {
                if (firstError.status === 429) {
                    const waitSec = firstError.retryAfter ?? 15;
                    console.warn(`[Groq] 429 한도 초과 → ${waitSec}초 후 재시도`);
                    const loadingText = loading?.querySelector('.loading-text');
                    if (loadingText) loadingText.textContent = `${waitSec}초 후 자동으로 재시도합니다 ⏳`;
                    await new Promise(r => setTimeout(r, waitSec * 1000));
                    answer = await this.getGroqResponse(text, context);
                } else {
                    throw firstError;
                }
            }

            if (loading) loading.remove();
            this.appendMessage('bot', answer);
        } catch (error) {
            console.error("Chat Error:", error);
            if (loading) loading.remove();

            let errorMsg = "죄송합니다. 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
            if (error.message.includes("API_KEY_INVALID") || error.message.includes("API key not valid")) {
                errorMsg = "API 키가 유효하지 않습니다. 관리자에게 문의하세요.";
            } else if (error.status === 429 || error.message.includes("QUOTA_EXCEEDED") || error.message.includes("quota")) {
                const waitSec = error.retryAfter ?? 15;
                errorMsg = `API 요청 한도를 초과했습니다. **${waitSec}초 후** 다시 시도해주세요.`;
            } else if (error.message.includes("MODEL_NOT_FOUND") || error.message.includes("not found")) {
                errorMsg = "모델을 찾을 수 없습니다. 관리자에게 문의하세요.";
            } else if (error.name === "TypeError" || error.message.includes("fetch")) {
                errorMsg = "네트워크 연결을 확인해주세요.";
            } else if (error.message.includes("API 호출 실패")) {
                errorMsg = `서버 오류가 발생했습니다. (${error.message})`;
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

    findRelevantContext(query) {
        // Simple search: rank by keyword matches
        const ranked = manualData.map(item => {
            let score = 0;
            item.keywords.forEach(kw => {
                if (query.includes(kw)) score += 2;
            });
            if (query.includes(item.category)) score += 1;
            if (item.text.includes(query)) score += 5;
            return { ...item, score };
        }).filter(item => item.score >= 5);  // 최소 2개 키워드 매칭 or 본문 직접 포함 수준 이상만 허용

        ranked.sort((a, b) => b.score - a.score);

        if (ranked.length > 0) {
            return ranked.slice(0, 2).map(item =>
                `[출처: ${item.source}]\n${item.text}`
            ).join('\n\n');
        }
        return '';
    }

    async getGroqResponse(userMessage, context = '') {
        const systemContent = `당신은 제주항공 객실훈련팀 AI 어시스턴트입니다.

절대 원칙:
- 교범에 명시된 내용만 답변하세요
- 교범에 없으면 절대 유추하거나 만들어내지 마세요
- 교범 내용이 없을 때는 반드시 이렇게만 답하세요:
  '해당 내용은 교범에서 확인되지 않아요. 담당 부서에 직접 문의해주세요.'
- 교범 내용이 일부만 있으면 있는 부분만 답하고 나머지는 모른다고 하세요
- 절대로 그럴듯하게 추측하지 마세요

[교범 내용]: ${context}
[질문]: ${userMessage}

교범 내용이 비어있거나 질문과 관련 없으면 바로 모른다고 답하세요.`;

        try {
            const response = await fetch(CONFIG.API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: CONFIG.MODEL,
                    messages: [
                        { role: 'system', content: systemContent },
                        { role: 'user',   content: userMessage }
                    ],
                    max_tokens: 1024
                })
            });

            // 레이트리밋 헤더 항상 콘솔 출력
            const rlHeaders = {
                remaining_req: response.headers.get('x-ratelimit-remaining-requests'),
                remaining_tok: response.headers.get('x-ratelimit-remaining-tokens'),
                reset_req:     response.headers.get('x-ratelimit-reset-requests'),
                reset_tok:     response.headers.get('x-ratelimit-reset-tokens'),
                retry_after:   response.headers.get('retry-after'),
            };
            console.log(`[Groq] model=${CONFIG.MODEL} status=${response.status}`, rlHeaders);

            if (!response.ok) {
                let errorData;
                try {
                    errorData = await response.json();
                } catch {
                    const err = new Error(`API 호출 실패 (HTTP ${response.status})`);
                    err.status = response.status;
                    throw err;
                }
                console.error("API 에러 상세:", errorData);
                const err = new Error(errorData.error?.message || `API 호출 실패 (HTTP ${response.status})`);
                err.status = response.status;
                // retry-after 헤더 값을 파싱해 에러 객체에 첨부
                const rawRetry = rlHeaders.retry_after || rlHeaders.reset_req;
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
        } catch (error) {
            if (error.name === "TypeError") {
                throw new TypeError("fetch 네트워크 오류: " + error.message);
            }
            throw error;
        }
    }
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    new ChatApp();
});
