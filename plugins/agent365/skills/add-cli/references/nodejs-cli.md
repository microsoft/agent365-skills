# Node.js LangChain — CLI Runner Pattern

Reference for the `add-cli` skill. All scaffolded code must be marked:
`// A365 CLI — added by add-cli skill`

Uses only Node.js built-in `readline` — no additional packages required.

---

## src/cli.ts — Full Pattern

```typescript
// A365 CLI — added by add-cli skill
import * as readline from 'readline';
import { createAgent } from './agentApp'; // adjust import to your agent factory

// A365 CLI — added by add-cli skill
async function main(): Promise<void> {
  const agent = await createAgent();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  console.log('A365 Agent CLI — type a message, Ctrl+C to exit');
  console.log('──────────────────────────────────────────────────');

  // A365 CLI — added by add-cli skill
  const prompt = (): void => {
    rl.question('You: ', async (input) => {
      if (!input.trim()) {
        prompt();
        return;
      }

      try {
        // A365 CLI — added by add-cli skill
        // Adjust invocation to match your agent's API
        const result = await agent.invoke({ input });
        const response = typeof result === 'string'
          ? result
          : result?.output ?? JSON.stringify(result);

        console.log(`Agent: ${response}\n`);
      } catch (err) {
        console.error(`Error: ${(err as Error).message}\n`);
      }

      prompt();
    });
  };

  // A365 CLI — added by add-cli skill
  process.on('SIGINT', () => {
    console.log('\nGoodbye.');
    rl.close();
    process.exit(0);
  });

  prompt();
}

// A365 CLI — added by add-cli skill
main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

---

## Streaming Variant (for agents with .stream())

```typescript
// A365 CLI — added by add-cli skill
rl.question('You: ', async (input) => {
  process.stdout.write('Agent: ');

  // A365 CLI — added by add-cli skill
  for await (const chunk of await agent.stream({ input })) {
    const text = chunk?.content ?? chunk?.output ?? '';
    process.stdout.write(text);
  }

  process.stdout.write('\n\n');
  prompt();
});
```

---

## package.json — CLI Scripts

Add to the `"scripts"` section:

```json
{
  "scripts": {
    "cli": "ts-node src/cli.ts",
    "cli:js": "node dist/cli.js"
  }
}
```

If `ts-node` is not installed:

```bash
npm install --save-dev ts-node
```

For compiled output, ensure `src/cli.ts` is included in the `tsconfig.json` `include` or `files` array.

---

## tsconfig.json — Include CLI File

Verify `src/cli.ts` is compiled:

```json
{
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

No changes are needed if `src/**/*` is already included.

---

## Run Commands

```bash
# TypeScript (development)
npm run cli

# Compiled JavaScript (after npm run build)
npm run cli:js

# Direct with npx if ts-node isn't installed
npx ts-node src/cli.ts
```

---

## Agent Factory Pattern

The CLI reuses the same agent factory as production. Ensure it is exported:

```typescript
// src/agentApp.ts
export async function createAgent() {
  // ... same setup as used in the HTTP handler
  return agent;
}
```

The HTTP entry point (`src/index.ts`) and CLI (`src/cli.ts`) both import from `agentApp.ts`.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Cannot find module './agentApp'` | Adjust import path to match your agent factory file |
| Agent hangs on `invoke()` | Check for missing env vars (OPENAI_API_KEY, AZURE_* credentials) |
| `ts-node: command not found` | Install with `npm install --save-dev ts-node` or use `npx ts-node` |
| Streaming produces garbled output | Ensure chunks have a consistent `content` or `output` property |
| Ctrl+C not caught | Ensure `process.on('SIGINT', ...)` is registered before `prompt()` is called |
