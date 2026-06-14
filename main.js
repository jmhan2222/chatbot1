import { manualData } from './data.js';

const CONFIG = {
    GROQ_API_KEY: "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",
    MODEL: "llama-3.3-70b-versatile",
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

            let answer;
            try {
                answer = await this.getGroqResponse(text, context);
            } catch (firstError) {
                if (firstError.status === 429) {
                    console.warn('[Groq] 429 한도 초과 → 10초 후 재시도');
                    const loadingText = loading.querySelector('.loading-text');
                    if (loadingText) loadingText.textContent = '잠시 후 답변드릴게요 ⏳';
                    await new Promise(r => setTimeout(r, 10000));
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
                errorMsg = "API 사용량 한도를 초과했습니다. 잠시 후 다시 시도해주세요.";
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
        }).filter(item => item.score > 0);

        ranked.sort((a, b) => b.score - a.score);

        if (ranked.length > 0) {
            return ranked.slice(0, 2).map(item => 
                `[출처: ${item.source}]\n${item.text}`
            ).join('\n\n');
        }
        return "관련 교범 내용을 찾지 못했습니다.";
    }

    async getGroqResponse(userMessage, context = '') {
        const systemContent = context
            ? `당신은 제주항공 객실본부 챗봇입니다. 아래 교범 내용을 참고해서 답변하세요.
교범에 없는 내용은 '교범에서 확인되지 않는 내용입니다'라고 답하세요.

답변은 반드시 다음 구조로 작성하세요:

**핵심 요약**
질문에 대한 결론을 2~3문장으로 먼저 설명합니다. 독자가 이 부분만 읽어도 핵심을 파악할 수 있어야 합니다.

---

**교범 상세 내용**
관련 교범 내용을 항목별로 정리합니다. 각 항목은 줄바꿈으로 구분하고, 중요한 키워드는 **굵게** 표시합니다.

[교범 내용]
${context}`
            : `당신은 제주항공 객실본부의 승무원 지원용 AI 챗봇입니다.

답변은 반드시 다음 구조로 작성하세요:

**핵심 요약**
질문에 대한 결론을 2~3문장으로 먼저 설명합니다. 독자가 이 부분만 읽어도 핵심을 파악할 수 있어야 합니다.

---

**상세 내용**
관련 내용을 항목별로 정리합니다. 중요한 키워드는 **굵게** 표시합니다.`;

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
