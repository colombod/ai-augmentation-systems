#!/usr/bin/env node
// UserPromptSubmit: one line with role and current claim.
try {
  const { readHookInput, promptSubmitText } = require('./role-context.js');
  const text = promptSubmitText(readHookInput());
  if (text) process.stdout.write(text);
} catch (err) {
  // swallow
}
process.exit(0);
