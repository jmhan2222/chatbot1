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
                this.appendMessage('bot', '관련 규정을 찾지 못했어요. 더 구체적으로 질문해주시거나 담당 부서에 확인해주세요 😊');
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
        }).filter(item => item.score >= 3);  // 키워드 최소 1개 본문 매칭(2점) + α 필요

        ranked.sort((a, b) => b.score - a.score);

        if (ranked.length > 0) {
            return ranked.slice(0, 2).map(item =>
                `[출처: ${item.source}]\n${item.text}`
            ).join('\n\n');
        }
        return '';
    }

    async getGroqResponse(userMessage, context = '') {
        const systemContent = context
            ? `당신은 제주항공 객실본부 AI 어시스턴트입니다.

【환각 방지 - 가장 중요한 원칙】
- 아래 [교범 내용]에 명시적으로 나온 내용만 답변하세요.
- [교범 내용]이 질문과 관련이 없으면 절대 추측하거나 만들어내지 마세요.
- 관련 내용을 찾을 수 없으면 반드시 "관련 규정을 찾지 못했어요. 더 구체적으로 질문해주시거나 담당 부서에 확인해주세요."라고만 답하세요.
- [교범 내용]에 일부만 언급되어 있다면 그 부분만 정확히 답하고, 나머지는 "추가 사항은 교범에서 확인이 안 되네요"라고 명확히 구분하세요.
- 절대로 교범에 없는 내용을 그럴듯하게 지어내지 마세요.

【답변 스타일】
- 간단한 질문은 1~2문장으로, 절차가 필요하면 번호를 매겨 단계별로, 여러 항목은 목록으로.
- 중요한 키워드나 수치는 **굵게** 강조하세요.
- 안전·비상·보안 관련 내용은 반드시 진지하고 정확하게 답변하세요.
- 가끔 이모지와 재치 있는 표현으로 대화를 자연스럽게 만드세요.
- 같은 표현을 반복하지 마세요.

[교범 내용]
${context}`
            : `당신은 제주항공 객실본부 AI 어시스턴트입니다. 관련 교범 내용이 없습니다. 반드시 "관련 규정을 찾지 못했어요. 더 구체적으로 질문해주시거나 담당 부서에 확인해주세요."라고만 답하세요.`;

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
