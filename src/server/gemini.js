const { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } = require('@google/generative-ai');
const fs = require('fs').promises;
const path = require('path');
const systemInstruction = require('../../systemInstruction');
const {
  GEMINI_API_KEY,
  QUALITY_MODEL_NAME,
} = require('./config');
const { getFileContextForError } = require('./generatedProject');

let genAI;

const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

function normalizeChatHistory(history = []) {
  if (!Array.isArray(history)) return [];

  const normalized = history
    .filter(item => (
      item &&
      (item.role === 'user' || item.role === 'model') &&
      Array.isArray(item.parts) &&
      item.parts.some(part => typeof part.text === 'string' && part.text.trim())
    ))
    .map(item => ({
      role: item.role,
      parts: item.parts
        .filter(part => typeof part.text === 'string' && part.text.trim())
        .map(part => ({ text: part.text })),
    }));

  while (normalized.length > 0 && normalized[0].role !== 'user') {
    normalized.shift();
  }

  const alternating = [];
  for (const item of normalized) {
    const previous = alternating[alternating.length - 1];
    if (previous && previous.role === item.role) {
      previous.parts.push(...item.parts);
    } else {
      alternating.push(item);
    }
  }

  return alternating;
}

function createChat(history = [], useSafetySettings = true) {
  if (!genAI) {
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  }

  const modelOptions = {
    model: QUALITY_MODEL_NAME,
    systemInstruction,
  };

  if (useSafetySettings) {
    modelOptions.safetySettings = safetySettings;
  }

  const model = genAI.getGenerativeModel(modelOptions);
  return model.startChat({ history: normalizeChatHistory(history) });
}

async function streamPromptResponse(prompt, history, sendEvent) {
  console.log(`[API] Using model: ${QUALITY_MODEL_NAME}`);
  console.log(`[SERVER DEBUG] Sending prompt to AI: "${prompt.substring(0, 100)}..."`);

  const chat = createChat(history, true);
  const result = await chat.sendMessageStream(prompt);
  let responseText = '';

  for await (const chunk of result.stream) {
    const textPart = chunk.text();
    if (textPart) {
      responseText += textPart;
      sendEvent({ stream: textPart });
    }
  }

  try {
    const fullResponse = await result.response;
    const feedback = fullResponse.promptFeedback;
    if (feedback) {
      console.log('[SERVER DEBUG] Full prompt feedback:', JSON.stringify(feedback, null, 2));
      if (feedback.blockReason) {
        console.error(`[SERVER DEBUG] CRITICAL: Prompt was blocked. Reason: ${feedback.blockReason}`);
      }
    }
  } catch (error) {
    console.error('[SERVER DEBUG] Error getting full response object:', error);
  }

  if (responseText.length === 0) {
    console.error('[SERVER DEBUG] CRITICAL: AI response text is empty after streaming.');
  }

  return responseText;
}

async function attemptToFixError(conversationHistory, errorLog, projectPath, sendEvent, options = {}) {
  const { requireFullProject = true } = options;
  console.log('[FIXER] An error was detected. Attempting AI-driven fix...');
  const isBuildError = /build failed|NPM install failed/i.test(errorLog);
  sendEvent({
    event: 'fixing-start',
    message: isBuildError
      ? 'A build error occurred. Analyzing the problem...'
      : 'The build succeeded, but a runtime error was detected. Attempting a fix...',
  });

  const fileContext = await getFileContextForError(errorLog, projectPath);
  const packageJsonContent = await fs
    .readFile(path.join(projectPath, 'package.json'), 'utf8')
    .catch(() => 'Could not read package.json.');

  const fixPrompt = `You are a senior debugger. The code you previously wrote has failed. You MUST fix it.

Follow these instructions to debug the code:
1. Analyze the error log carefully to understand the exact error message, file, and line number.
2. Examine the problematic file if provided. Cross-reference the error log with this code.
3. Check dependencies using package.json. The error might be due to a breaking change or incorrect import syntax.
4. ${requireFullProject
  ? 'Respond with the complete, corrected codebase.'
  : 'Respond only with the complete contents of files that need to change.'} Do not write apologies or explanations outside of the <plan>.

---
ERROR LOG:
\`\`\`
${errorLog}
\`\`\`
---
${fileContext ? `
FILE WITH ERROR (${fileContext.filePath}):
\`\`\`typescript
${fileContext.fileContent}
\`\`\`
---
` : ''}
PROJECT DEPENDENCIES (package.json):
\`\`\`json
${packageJsonContent}
\`\`\`
---
Now, provide the corrected and complete project code.`;

  try {
    const chat = createChat(conversationHistory, false);
    const result = await chat.sendMessageStream(fixPrompt);
    let fullResponseText = '';

    for await (const chunk of result.stream) {
      fullResponseText += chunk.text();
    }

    console.log('[FIXER] Received corrected code from AI.');
    sendEvent({ event: 'fixing-code-received', message: 'Applying corrected code...' });
    return fullResponseText;
  } catch (error) {
    console.error('[FIXER] AI failed to provide a fix:', error);
    throw new Error('The AI failed to provide a valid fix.');
  }
}

module.exports = {
  attemptToFixError,
  normalizeChatHistory,
  streamPromptResponse,
};
