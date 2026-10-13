#!/usr/bin/env node
// UserPromptSubmit: capture the operator's words (operator-capture.js), then one line with role and current claim.
try {
  const { readHookInput, promptSubmitText } = require('./role-context.js');
  const text = promptSubmitText(readHookInput(), { warn: (m) => process.stderr.write(m) });
  if (text) process.stdout.write(text);
} catch (err) {
  // swallow
}
process.exit(0);
