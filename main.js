import { manualData } from './data.js';

// Configuration
const CONFIG = {
    GEMINI_API_KEY: "AIzaSyCzUxlyC4pU1dJk2bjz-Uh9BL-2XiGHEZQ",
    MODEL: "gemini-1.5-flash",
    API_URL: "https://generativelanguage.googleapis.com/v1beta/models"
};

class ChatApp {
    constructor() {
        this.chatContainer = document.getElementById('chat-container');
        this.userInput = document.getElementById('user-input');
        this.sendBtn = document.getElementById('send-btn');
        this.isTyping = false;

        this.init();
    }

    init() {
        this.sendBtn.addEventListener('click', () => this.handleSend());
        this.userInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleSend();
        });

        // Focus input on load
        this.userInput.focus();
    }

    async handleSend() {
        const text = this.userInput.value.trim();
        if (!text || this.isTyping) return;

        this.isTyping = true;
        this.appendMessage('user', text);
        this.userInput.value = '';
        this.userInput.disabled = true;

        const loading = this.showLoading();

        try {
            const context = this.findRelevantContext(text);
            const answer = await this.getGeminiResponse(text, context);
            
            loading.remove();
            this.appendMessage('bot', answer);
        } catch (error) {
            console.error("Chat Error:", error);
            loading.remove();
            this.appendMessage('bot', "죄송합니다. 오류가 발생했습니다. 다시 시도해 주세요.");
        } finally {
            this.isTyping = false;
            this.userInput.disabled = false;
            this.userInput.focus();
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
            <div class="loading">
                <div class="dot"></div>
                <div class="dot"></div>
                <div class="dot"></div>
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

    async getGeminiResponse(query, context) {
        if (CONFIG.GEMINI_API_KEY === "YOUR_GEMINI_API_KEY_HERE") {
            return "API 키가 설정되지 않았습니다. `main.js` 파일에서 `GEMINI_API_KEY`를 설정해 주세요.";
        }

        const url = `${CONFIG.API_URL}/${CONFIG.MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`;
        
        const prompt = `
            당신은 제주항공 객실본부의 승무원 지원용 AI 챗봇입니다.
            제공된 [교범 데이터]를 기반으로 사용자의 질문에 답변하세요.
            
            [교범 데이터]
            ${context}
            
            [사용자 질문]
            ${query}
            
            지침:
            1. 교범에 근거하여 정확하고 친절하게 답변하세요.
            2. 관련 내용이 교범에 없을 경우, 일반적인 항공 안전 지식을 제공하되 "정확한 내용은 교범을 재확인하시기 바랍니다"라고 덧붙이세요.
            3. 답변은 5줄 이내로 간결하게 작성하세요.
            4. 중요한 단어는 **굵게** 표시하세요.
            5. 한국어로 답변하세요.
        `;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error("Gemini API Error Details:", errorData);
            const errorMessage = errorData.error?.message || `API returned ${response.status}`;
            throw new Error(errorMessage);
        }

        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "답변을 가져오지 못했습니다.";
    }
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    new ChatApp();
});
