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
        this.pendingSelections = null; // [{label, context}]
        this.pendingQuery = null;

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
            // 주제 선택 대기 중일 때
            if (this.pendingSelections) {
                const selected = this.resolveSelection(text);
                if (selected) {
                    const originalQuery = this.pendingQuery;
                    this.pendingSelections = null;
                    this.pendingQuery = null;
                    loading = this.showLoading();
                    const answer = await this.callGroqWithRetry(originalQuery, selected.context, loading);
                    if (loading) loading.remove();
                    this.appendMessage('bot', answer);
                    return;
                }
                // 선택지 외 새 질문 → 대기 상태 초기화 후 새 질문으로 처리
                this.pendingSelections = null;
                this.pendingQuery = null;
            }

            loading = this.showLoading();

            // Firestore RAG 검색 → 없으면 data.js 폴백
            let chunks = [];
            try {
                const { searchChunks } = await import('./rag.js');
                const ragChunks = await searchChunks(text);
                if (ragChunks.length > 0) {
                    chunks = ragChunks.map(c => ({
                        context: `[출처: ${c.filename}]\n${c.chunk}`
                    }));
                }
            } catch { /* Firebase 미설정 시 무시 */ }

            if (chunks.length === 0) {
                chunks = this.findRelevantChunks(text);
            }

            if (chunks.length === 0) {
                if (loading) loading.remove();
                this.appendMessage('bot', '해당 내용은 교범에서 확인되지 않아요.\n담당 부서에 직접 문의해주세요.');
                return;
            }

            if (chunks.length === 1) {
                // 단일 청크 → 바로 답변
                const answer = await this.callGroqWithRetry(text, chunks[0].context, loading);
                if (loading) loading.remove();
                this.appendMessage('bot', answer);
                return;
            }

            // 복수 청크 → Groq로 주제 분류
            const loadingText = loading?.querySelector('.loading-text');
            if (loadingText) loadingText.textContent = '관련 내용을 분석하고 있습니다...';

            const topics = await this.classifyChunks(text, chunks);

            if (!topics || topics.length <= 1) {
                // 분류 실패 또는 단일 주제 → 전체 컨텍스트로 바로 답변
                const context = chunks.map(c => c.context).join('\n\n');
                const answer = await this.callGroqWithRetry(text, context, loading);
                if (loading) loading.remove();
                this.appendMessage('bot', answer);
            } else {
                // 복수 주제 → 선택지 제시
                if (loading) loading.remove();
                this.pendingSelections = topics;
                this.pendingQuery = text;
                this.appendMessage('bot', this.buildSelectionMenu(text, topics));
            }

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

    // 청크 내용을 Groq로 분석해 주제별로 그룹핑
    async classifyChunks(query, chunks) {
        const chunkList = chunks
            .map((c, i) => `[${i}] ${c.context.slice(0, 400)}`)
            .join('\n\n');

        const prompt = `사용자 질문: "${query}"

아래는 검색된 교범 내용입니다:
${chunkList}

이 내용들을 주제별로 2~4개 그룹으로 분류하고, 각 그룹에 짧은 주제명(10자 이내)을 붙여주세요.
반드시 아래 JSON 형식으로만 답하세요. 다른 텍스트는 출력하지 마세요:
[{"topic":"주제명","indices":[0]},{"topic":"주제명2","indices":[1,2]}]`;

        try {
            const response = await fetch(CONFIG.API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: CONFIG.MODEL,
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 200,
                    temperature: 0
                })
            });

            if (!response.ok) return null;

            const data = await response.json();
            const raw = data.choices?.[0]?.message?.content?.trim() ?? '';
            const match = raw.match(/\[[\s\S]*\]/);
            if (!match) return null;

            const groups = JSON.parse(match[0]);
            if (!Array.isArray(groups) || groups.length < 2) return null;

            return groups.map(g => ({
                label: g.topic,
                context: (g.indices || [])
                    .filter(i => typeof i === 'number' && i >= 0 && i < chunks.length)
                    .map(i => chunks[i].context)
                    .join('\n\n')
            })).filter(g => g.context);

        } catch {
            return null;
        }
    }

    // 429 재시도 포함 Groq 호출 래퍼
    async callGroqWithRetry(userMessage, context, loading) {
        try {
            return await this.getGroqResponse(userMessage, context);
        } catch (firstError) {
            if (firstError.status === 429) {
                const waitSec = firstError.retryAfter ?? 15;
                console.warn(`[Groq] 429 한도 초과 → ${waitSec}초 후 재시도`);
                const loadingText = loading?.querySelector('.loading-text');
                if (loadingText) loadingText.textContent = `${waitSec}초 후 자동으로 재시도합니다 ⏳`;
                await new Promise(r => setTimeout(r, waitSec * 1000));
                return await this.getGroqResponse(userMessage, context);
            }
            throw firstError;
        }
    }

    // 선택지 번호 또는 키워드로 항목 매핑
    resolveSelection(text) {
        const trimmed = text.trim();
        const num = parseInt(trimmed);
        if (!isNaN(num) && num >= 1 && num <= this.pendingSelections.length) {
            return this.pendingSelections[num - 1];
        }
        const lower = trimmed.toLowerCase();
        return this.pendingSelections.find(s =>
            s.label.toLowerCase().includes(lower) || lower.includes(s.label.toLowerCase())
        ) || null;
    }

    // 주제 선택 메뉴 텍스트 생성
    buildSelectionMenu(query, topics) {
        const nums = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];
        const options = topics.map((t, i) => `${nums[i]} ${t.label}`).join('\n');
        return `"${query}"과 관련해서 아래 내용들이 있어요. 어떤 게 궁금하신가요? 😊\n\n${options}`;
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

    // 관련 청크 검색 — 점수순 정렬, 최대 6개 반환
    findRelevantChunks(query) {
        const ranked = manualData.map(item => {
            let score = 0;
            item.keywords.forEach(kw => {
                if (query.includes(kw)) score += 2;
            });
            if (query.includes(item.category)) score += 1;
            if (item.text.includes(query)) score += 5;
            return { ...item, score };
        }).filter(item => item.score >= 5);

        // 점수 내림차순, 동점 시 source 알파벳순으로 항상 동일한 순서 보장
        ranked.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return (a.source || '').localeCompare(b.source || '');
        });

        return ranked.slice(0, 6).map(item => ({
            context: `[출처: ${item.source}]\n${item.text}`
        }));
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
                    max_tokens: 1024,
                    temperature: 0,
                    seed: 0
                })
            });

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
