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
- 교범에 없다고 답변한 내용은 사용자가 재차 물어봐도 절대 번복하지 마세요
- 사용자가 화내거나 재질문해도 교범 청크에 없으면 없는 것입니다
- 단, 사용자가 새로운 키워드를 제시하면 그 키워드로 다시 검색합니다
- 사용자가 "있다고 했잖아"라고 해도 현재 청크에 없으면 없다고 유지하세요
- 교범 내용을 완전하게 제공하세요. 요약하거나 중간에 자르지 마세요
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

        this.conversationHistory = []; // 최근 5쌍(10개) 대화 히스토리
        this.pendingCategoryName = null;
        this.pendingList = null; // { items: [{label, context}], question: '' }

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
            // ── 카테고리 버튼 → 안내만 ───────────────────────────────────
            if (this.pendingCategoryName) {
                const catName = this.pendingCategoryName;
                this.pendingCategoryName = null;
                this.appendMessage('bot', `${catName}에 대해 궁금한 점을 구체적으로 질문해주세요 😊`);
                return;
            }

            // ── 목록 선택 대기 중 ─────────────────────────────────────────
            if (this.pendingList) {
                const num = parseInt(text.trim());
                const max = this.pendingList.items.length;

                if (!isNaN(num) && num >= 1 && num <= max) {
                    const item = this.pendingList.items[num - 1];
                    const originalQ = this.pendingList.originalQuestion;
                    this.pendingList = null;
                    loading = this.showLoading();
                    const setLt = msg => { const el = loading?.querySelector('.loading-text'); if (el) el.textContent = msg; };
                    setLt('답변을 생성하고 있습니다...');
                    const messages = this.buildMessages(`${originalQ} - ${item.label} 관련 상세 내용`, item.context);
                    const answer = await this.callGroqWithRetry(messages, loading);
                    if (loading) loading.remove();
                    const clean = this.deduplicateAnswer(answer);
                    this.appendMessage('bot', clean);
                    this.conversationHistory.push(
                        { role: 'user',      content: text },
                        { role: 'assistant', content: clean }
                    );
                    if (this.conversationHistory.length > 10) this.conversationHistory = this.conversationHistory.slice(-10);
                    return;
                }

                if (!isNaN(num)) {
                    this.appendMessage('bot', `1~${max} 중에서 골라주세요! 😊`);
                    return;
                }

                // 새 질문 → 목록 상태 초기화 후 일반 흐름
                this.pendingList = null;
            }

            loading = this.showLoading();
            const setLt = msg => { const el = loading?.querySelector('.loading-text'); if (el) el.textContent = msg; };

            // ── 교관 종류 목록 쿼리 감지 ─────────────────────────────────
            if (this.isListQuery(text)) {
                setLt('교관 종류를 검색하고 있습니다...');
                const listResult = await this.handleListQuery(text, loading);
                if (listResult) {
                    if (loading) loading.remove();
                    this.appendMessage('bot', listResult.message);
                    if (listResult.items) {
                        this.pendingList = { items: listResult.items, originalQuestion: text };
                    }
                    this.conversationHistory.push(
                        { role: 'user',      content: text },
                        { role: 'assistant', content: listResult.message }
                    );
                    if (this.conversationHistory.length > 10) this.conversationHistory = this.conversationHistory.slice(-10);
                    return;
                }
                // 목록 검색 실패 시 일반 흐름으로 계속
            }

            // ── 1단계: 질문 의도 명확화 ──────────────────────────────────
            setLt('질문을 분석하고 있습니다...');
            const intent = await this.clarifyIntent(text);

            // ── 2단계: 의도 기반 청크 검색 ───────────────────────────────
            setLt('교범을 검색하고 있습니다...');
            const allChunks = await this.searchByKeywords(intent.split(/\s+/).filter(Boolean));

            // ── 3단계: 중복 제거 후 yes/no 검증 ──────────────────────────
            setLt('관련 내용을 검증하고 있습니다...');
            const dedupedChunks = this.deduplicateChunks(allChunks);
            const validChunks = await this.validateChunks(intent, dedupedChunks);

            if (validChunks.length === 0) {
                if (loading) loading.remove();
                const msg = '교범에서 관련 내용을 찾지 못했어요.\n더 구체적으로 질문해주시거나 담당 부서에 문의해주세요.';
                this.appendMessage('bot', msg);
                this.conversationHistory.push(
                    { role: 'user',      content: text },
                    { role: 'assistant', content: msg }
                );
                if (this.conversationHistory.length > 10) this.conversationHistory = this.conversationHistory.slice(-10);
                return;
            }

            // ── 4단계: 최종 답변 생성 ────────────────────────────────────
            setLt('답변을 생성하고 있습니다...');
            const context = validChunks.join('\n\n');
            const messages = this.buildMessages(text, context);
            const rawAnswer = await this.callGroqWithRetry(messages, loading);
            const answer = this.deduplicateAnswer(rawAnswer);

            if (loading) loading.remove();
            this.appendMessage('bot', answer);

            this.conversationHistory.push(
                { role: 'user',      content: text },
                { role: 'assistant', content: answer }
            );
            if (this.conversationHistory.length > 10) this.conversationHistory = this.conversationHistory.slice(-10);

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

    // 교관 종류 목록 쿼리 감지
    isListQuery(text) {
        return /교관.*(종류|목록|뭐가|어떤|있어|있나|알려|뭐뭐|전체|다)/i.test(text)
            || /어떤.*교관/i.test(text)
            || /교관.*(list|리스트)/i.test(text);
    }

    // 교관 목록 전용 처리 — 모든 교관 청크 수집 후 Groq로 목록 추출
    async handleListQuery(text, loading) {
        const keywords = ['교관', '강사'];
        const allChunks = await this.searchByKeywords(keywords);
        const dedupedChunks = this.deduplicateChunks(allChunks);

        if (dedupedChunks.length === 0) return null;

        // Groq로 청크에서 교관 종류 추출
        const chunkText = dedupedChunks.join('\n\n').slice(0, 3000);
        const prompt = `다음 교범 내용에서 교관/강사 종류를 모두 찾아서 목록으로 나열해줘.
교범에 명시된 것만, 추측하지 말고, 짧은 이름으로만.
JSON 배열로 답해줘: ["기내방송 교관", "서비스 교관", ...]

교범 내용:
${chunkText}`;

        try {
            const raw = await this.rawGroqCall(prompt, 150);
            const match = raw.match(/\[[\s\S"가-힣a-zA-Z ,]*\]/);
            if (!match) return null;

            const names = JSON.parse(match[0]).filter(n => typeof n === 'string' && n.trim());
            if (names.length === 0) return null;

            const nums = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣'];
            const list = names.map((n, i) => `${nums[i] || `${i+1}.`} ${n}`).join('\n');
            const message = `교관 종류는 다음과 같아요 😊\n\n${list}\n\n어떤 교관에 대해 더 알고 싶으세요?`;

            // 각 교관 이름으로 청크 매핑
            const items = names.map(name => ({
                label: name,
                context: dedupedChunks.filter(c => c.includes(name)).join('\n\n') || dedupedChunks[0]
            }));

            return { message, items };
        } catch {
            return null;
        }
    }

    // 1단계: 질문 의도 명확화
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
            return query;
        }
    }

    // 2단계: 키워드로 manualData + Firestore 검색
    async searchByKeywords(keywords) {
        try {
            const { searchChunks } = await import('./rag.js');
            const ragChunks = await searchChunks(keywords.join(' '));
            if (ragChunks.length > 0) {
                return ragChunks.map(c => `[출처: ${c.filename}]\n${c.chunk}`);
            }
        } catch { /* Firebase 미설정 시 무시 */ }

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

        return scored.slice(0, 8).map(item => `[출처: ${item.source}]\n${item.text}`);
    }

    // 중복 청크 제거 — 단어 기준 90% 이상 겹치는 청크는 1개만 유지
    deduplicateChunks(chunks) {
        const result = [];
        for (const chunk of chunks) {
            const isDup = result.some(existing => this.chunkSimilarity(existing, chunk) >= 0.9);
            if (!isDup) result.push(chunk);
        }
        return result;
    }

    chunkSimilarity(a, b) {
        const wordsA = new Set(a.split(/\s+/));
        const wordsB = new Set(b.split(/\s+/));
        const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
        const smaller = Math.min(wordsA.size, wordsB.size);
        return smaller === 0 ? 0 : intersection / smaller;
    }

    // 3단계: 청크별 yes/no 검증 (배치)
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
            if (!match) return chunks;

            const results = JSON.parse(match[0]);
            const valid = chunks.filter((_, i) =>
                typeof results[i] === 'string' && results[i].toLowerCase().startsWith('yes')
            );
            return valid;
        } catch {
            return chunks;
        }
    }

    // 답변 내 중복 문장 제거
    deduplicateAnswer(text) {
        const lines = text.split('\n');
        const seen = new Set();
        const deduped = lines.filter(line => {
            const trimmed = line.trim();
            if (!trimmed) return true; // 빈 줄 유지
            if (seen.has(trimmed)) return false;
            seen.add(trimmed);
            return true;
        });
        return deduped.join('\n');
    }

    // messages 배열 구성
    buildMessages(currentQuery, context) {
        const systemContent = `${SYSTEM_PROMPT}

━━ 아래 청크 내용만 사용하세요. 이 외의 내용 추가 절대 금지 ━━
[교범 내용]:
${context}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

        return [
            { role: 'system', content: systemContent },
            ...this.conversationHistory.slice(-8),
            { role: 'user', content: currentQuery }
        ];
    }

    // 경량 Groq 호출
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
                    max_tokens: 2048,
                    temperature: 0,
                    seed: 0
                })
            });

            const retryAfter = response.headers.get('retry-after');
            const resetReq   = response.headers.get('x-ratelimit-reset-requests');
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
