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

        const context = this.findRelevantContext(text);
        const fullPrompt = `[교범 데이터]\n${context}\n\n[사용자 질문]\n${text}`;

        let loading;
        try {
            loading = this.showLoading();

            let answer;
            try {
                answer = await this.getGroqResponse(fullPrompt);
            } catch (firstError) {
                if (firstError.status === 429) {
                    console.warn('[Groq] 429 한도 초과 → 10초 후 재시도');
                    const loadingText = loading.querySelector('.loading-text');
                    if (loadingText) loadingText.textContent = '잠시 후 답변드릴게요 ⏳';
                    await new Promise(r => setTimeout(r, 10000));
                    answer = await this.getGroqResponse(fullPrompt);
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
        
        // Simple markdown-like replacement
        const formattedText = text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
        
        msgDiv.innerHTML = `
            <div class="bubble">${formattedText}</div>
            <div class="timestamp">${timeStr}</div>
        `;
        
        this.chatContainer.appendChild(msgDiv);
        this.scrollToBottom();
    }

    showLoading() {
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'message bot loading-container';
        loadingDiv.innerHTML = `
            <div class="bubble loading-bubble">
                <div class="loading">
                    <div class="dot"></div>
                    <div class="dot"></div>
                    <div class="dot"></div>
                </div>
                <span class="loading-text">답변을 생성하고 있습니다...</span>
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

    async getGroqResponse(userMessage) {
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
                        {
                            role: 'system',
                            content: `당신은 제주항공 객실본부의 승무원 지원용 AI 챗봇입니다.
제공된 교범 데이터를 기반으로 사용자의 질문에 답변하세요.
지침:
1. 교범에 근거하여 정확하고 친절하게 답변하세요.
2. 관련 내용이 교범에 없을 경우, 일반적인 항공 안전 지식을 제공하되 "정확한 내용은 교범을 재확인하시기 바랍니다"라고 덧붙이세요.
3. 답변은 5줄 이내로 간결하게 작성하세요.
4. 중요한 단어는 **굵게** 표시하세요.
5. 한국어로 답변하세요.`
                        },
                        {
                            role: 'user',
                            content: userMessage
                        }
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
