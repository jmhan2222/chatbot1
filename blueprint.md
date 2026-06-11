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
1. **[Completed] Step 1: Design the UI.** Create the HTML/CSS structure for the KakaoTalk-style interface.
2. **[Completed] Step 2: JSON Integration.** Prepare the sample manual data and implement the search logic.
3. **[Completed] Step 3: Gemini API Connection.** Add the JavaScript logic to call Gemini with matched context.
4. **[Completed] Step 4: Refactoring & Modernization.** 
    - Move inline CSS and JS to external files (`style.css`, `main.js`).
    - Implement ES Modules for better organization.
    - Enhance UI with modern CSS features (Container Queries, `:has()`, logical properties).
    - Improve error handling and loading states.
5. **[Current] Step 5: Advanced Features & Polishing.**
    - Add subtle noise textures and multi-layered shadows for a premium feel.
    - Implement smooth transitions and interactive feedback.
    - Final validation and accessibility checks.
