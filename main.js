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
        const basePrompt = `당신은 제주항공 객실본부 AI 어시스턴트입니다.
객실승무원들의 든든한 동료처럼 친근하고 자연스럽게 답변하세요.

답변 원칙:
- 교범 내용이 있으면 핵심만 자연스럽게 전달하세요. "핵심 요약", "교범 상세 내용" 같은 딱딱한 제목은 쓰지 마세요.
- 간단한 질문은 1~2문장으로 짧게, 절차가 필요하면 번호를 매겨 단계별로, 여러 항목은 목록으로 정리하세요.
- 중요한 키워드나 수치는 **굵게** 강조하세요.
- 안전·비상·보안 관련 내용은 반드시 진지하고 정확하게 답변하세요.
- 가끔 이모지와 재치 있는 표현을 섞어 대화를 자연스럽게 만드세요. (예: "교범을 샅샅이 뒤져봤는데요! 🔍", "이건 자신 있게 말씀드릴 수 있어요! 💪")
- 같은 표현을 반복하지 마세요.`;

        const noContextPrompt = `교범에서 관련 내용을 찾지 못했습니다. 질문의 맥락에 따라 아래처럼 다양하게 안내하세요:
- 규정·절차 관련: "해당 규정은 아직 교범에 업데이트가 필요한 것 같아요! 담당 부서에 문의해보시는 게 좋을 것 같습니다 😊"
- 일반적인 질문: "음... 교범에서는 찾기가 어렵네요. 혹시 다른 방식으로 질문해볼까요?"
- 객실본부와 무관한 질문: "저는 객실본부 전문가라 그건 좀 어렵지만... 비행 관련이라면 뭐든 물어보세요! ✈️"
질문 내용에 맞게 자연스럽게 선택해서 답변하세요.`;

        const systemContent = context
            ? `${basePrompt}

아래 교범 내용을 바탕으로 답변하세요. 교범에 없는 내용은 솔직하게 모른다고 하되, 맥락에 맞게 다양한 표현으로 안내하세요.

[교범 내용]
${context}`
            : `${basePrompt}

${noContextPrompt}`;

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
