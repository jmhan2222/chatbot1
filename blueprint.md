# Jeju Air Cabin Division Chatbot Blueprint

## Overview
A mobile-web chatbot for Jeju Air Cabin Division crew members. It provides quick answers to manual-related questions by matching user queries with pre-defined JSON data and processing them through the Gemini API.

## Features & Design
- **UI Style:** KakaoTalk-inspired mobile chat interface.
- **Branding:** Jeju Air's signature orange color (#FF6700) and clean typography.
- **Components:**
    - Fixed top navigation bar with an orange border/background.
    - Scrollable chat area with speech bubbles (crew vs. bot).
    - Floating input area at the bottom.
- **Intelligence:**
    - Local JSON data matching for context.
    - Gemini API integration for natural language response generation.
- **Deployment:** Optimized for Cloudflare Pages (single-file or simple structure).

## Technical Stack
- **Frontend:** HTML5, CSS3 (Modern Baseline), Vanilla JavaScript (ES Modules).
- **API:** Google Gemini API.
- **Data:** JSON-based manual snippets.

## Implementation Plan
1. **[Current] Step 1: Design the UI.** Create the HTML/CSS structure for the KakaoTalk-style interface.
2. **Step 2: JSON Integration.** Prepare the sample manual data and implement the search logic.
3. **Step 3: Gemini API Connection.** Add the JavaScript logic to call Gemini with matched context.
4. **Step 4: Final Polishing.** Add animations, textures, and responsiveness checks.
