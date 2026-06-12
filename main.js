import { manualData } from './data.js';

// Configuration
const CONFIG = {
    GEMINI_API_KEY: "AQ.Ab8RN6JgkEa49tLrcWLB9g3PX379iluOp_p6tE-WHDocoVUGUA",
    MODEL: "gemini-2.0-flash",
    API_URL: "https://generativelanguage.googleapis.com/v1beta/models"
};

class ChatApp {
    constructor() {
        this.chatContainer = document.getElementById('chat-container');
        this.userInput = document.getElementById('user-input');
        this.sendBtn = document.getElementById('send-btn');
        this.apiKey = CONFIG.GEMINI_API_KEY;
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
        this.appendMessage('user', text);
        this.userInput.value = '';
        this.userInput.disabled = true;

        let loading;
        try {
            loading = this.showLoading();
            const context = this.findRelevantContext(text);
            
            // Construct full prompt here
            const fullPrompt = `
                당신은 제주항공 객실본부의 승무원 지원용 AI 챗봇입니다.
                제공된 [교범 데이터]를 기반으로 사용자의 질문에 답변하세요.
                
                [교범 데이터]
                ${context}
                
                [사용자 질문]
                ${text}
                
                지침:
                1. 교범에 근거하여 정확하고 친절하게 답변하세요.
                2. 관련 내용이 교범에 없을 경우, 일반적인 항공 안전 지식을 제공하되 "정확한 내용은 교범을 재확인하시기 바랍니다"라고 덧붙이세요.
                3. 답변은 5줄 이내로 간결하게 작성하세요.
                4. 중요한 단어는 **굵게** 표시하세요.
                5. 한국어로 답변하세요.
            `;

            const answer = await this.getGeminiResponse(fullPrompt);
            
            if (loading) loading.remove();
            this.appendMessage('bot', answer);
        } catch (error) {
            console.error("Chat Error:", error);
            if (loading) loading.remove();

            let errorMsg = "죄송합니다. 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
            if (error.message.includes("API_KEY_INVALID") || error.message.includes("API key not valid")) {
                errorMsg = "API 키가 유효하지 않습니다. 관리자에게 문의하세요.";
            } else if (error.message.includes("QUOTA_EXCEEDED") || error.message.includes("quota")) {
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

    async getGeminiResponse(prompt) {
        const url = `${CONFIG.API_URL}/${CONFIG.MODEL}:generateContent?key=${this.apiKey}`;
        console.log(`[Gemini] 요청 시작 → 모델: ${CONFIG.MODEL}`);
        
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: prompt
                        }]
                    }]
                })
            });

            if (!response.ok) {
                let errorData;
                try {
                    errorData = await response.json();
                } catch {
                    throw new Error(`API 호출 실패 (HTTP ${response.status})`);
                }
                console.error("API 에러 상세:", errorData);
                throw new Error(errorData.error?.message || `API 호출 실패 (HTTP ${response.status})`);
            }

            const data = await response.json();

            if (data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
                console.log(`[Gemini] 응답 수신 성공 (finishReason: ${data.candidates[0].finishReason})`);
                return data.candidates[0].content.parts[0].text;
            } else if (data.candidates && data.candidates[0]?.finishReason === "SAFETY") {
                throw new Error("안전 정책에 의해 응답이 차단되었습니다.");
            } else {
                throw new Error("응답 데이터 구조가 올바르지 않습니다.");
            }
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
