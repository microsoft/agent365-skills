---
name: add-notifications
description: >
  Adds Agent 365 notification handling and lifecycle events to an AI Teammate Node.js LangChain agent.
  Installs @microsoft/agents-a365-notifications, registers onAgentNotification('agents:*') for email
  notifications, and registers onActivity(InstallationUpdate) for install/uninstall lifecycle events.
  Non-destructive and idempotent. Only applies to AI Teammate agents.
compatibility:
  - claude-code
  - vscode-copilot
user-invocable: true
argument-hint: "Optional: notification types to add (e.g. 'email' or 'all')"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
model: sonnet
hooks:
  stop:
    - type: prompt
      prompt: |
        Before ending, verify ALL of the following:
        1. Agent type was confirmed as AI Teammate (Node.js LangChain).
        2. @microsoft/agents-a365-notifications is present in package.json dependencies.
        3. Side-effect import '@microsoft/agents-a365-notifications' is in the agent file.
        4. onAgentNotification('agents:*', ...) is registered in the constructor.
        5. handleAgentNotificationActivity dispatches on NotificationType.EmailNotification.
        6. handleEmailNotification uses createEmailResponseActivity for replies.
        7. onActivity(ActivityTypes.InstallationUpdate, ...) is registered.
        8. handleInstallationUpdateActivity sends welcome/farewell messages.
        9. Build/compile succeeds.
        If any item failed or was skipped, return {"ok": false, "reason": "<specific item>"}.
        If all items completed successfully, return {"ok": true}.
      timeout: 30000
---

# Add Agent 365 Notifications

> **Trigger phrases** — any of these will activate this skill automatically:
> - "add notifications to this agent"
> - "add a365 notifications"
> - "handle agent notifications"
> - "wire notification handler"
> - "add email notifications"
> - "handle install uninstall events"
> - "add ai teammate notifications"

> **IMPORTANT:** This skill only applies to **AI Teammate** agents. If the agent is not
> registered (or planned) as an AI Teammate, tell the user and stop — notifications require
> an AI Teammate blueprint with a registered messaging endpoint.

---

## Phase 0A — Silent Detection and User Validation

### Silent Detection

**First: Check for detection cache.** Read `.a365-workspace-detection.json` if it exists. If
`detectedAt` is within the last 60 minutes, load `agentStack`, `programmingLanguage`, and
`usesTeamsOrCopilot` from it and skip detection — go straight to User Validation.

Run all three detection globs **in parallel**:

**Step 1: Detect Agent Stack** → Store as `agentStack`
- Check for .csproj + Microsoft.Agents.* → `Agent Framework`
- Check for package.json + @langchain → `LangChain`
- Check for package.json + "openai" (no LangChain) → `OpenAI`

**Step 2: Detect Programming Language** → Store as `programmingLanguage`
- .csproj exists → `DotNet`
- package.json exists → `NodeJS`

**Step 3: Detect AI Teammate status** → Store as `usesTeamsOrCopilot`
- a365.config.json OR a365.generated.config.json present → `1`
- Otherwise → `0`

### User Validation

Present all detections in one message and wait for ONE response:

```
Here's what we detected about your agent:
  • Stack:       {agentStack}
  • Language:    {programmingLanguage}
  • AI Teammate: {usesTeamsOrCopilot == 1 ? "Yes (a365.config.json found)" : "Not detected"}

Reply **yes** to confirm, or describe any corrections.
```

After confirming, write `.a365-workspace-detection.json` (see `agent-detection.md` cache format).

**Gate check:** If `programmingLanguage !== NodeJS`, tell the user:
> "This skill currently supports Node.js LangChain agents only. .NET support is coming soon."
> Stop.

---

## Phase 0B — Create Task List

```
TaskCreate: "Detect agent type and check prerequisites"
TaskCreate: "Install @microsoft/agents-a365-notifications"
TaskCreate: "Wire onAgentNotification handler in constructor"
TaskCreate: "Implement email notification handler"
TaskCreate: "Wire InstallationUpdate lifecycle handler"
TaskCreate: "Validate build"
```

---

## Phase 1 — Detect Agent Type and Check Prerequisites

**Mark task in progress: "Detect agent type and check prerequisites"**

### 1.1 Load reference patterns

**Read** `${CLAUDE_PLUGIN_ROOT}/skills/add-notifications/references/nodejs-notifications.md`

### 1.2 Locate the agent class

**Glob** `src/**/*.ts` and **Grep** `extends AgentApplication` to find the agent class file.
Store as `agentFile`.

If not found, **Grep** `onActivity` across `src/**/*.ts` to find the message handler file.

### 1.3 Check if already wired

**Grep** `onAgentNotification` in `agentFile`. If found, report:
> "Notification handler already present — checking for completeness."

Inspect whether `handleEmailNotification` and `handleInstallationUpdateActivity` are also
present. Identify and fill any missing pieces; skip what is already there.

**Mark task complete: "Detect agent type and check prerequisites"**

---

## Phase 2 — Install @microsoft/agents-a365-notifications

**Mark task in progress: "Install @microsoft/agents-a365-notifications"**

### 2.1 Check if already installed

**Grep** `agents-a365-notifications` in `**/package.json`.

If already present, skip install and mark complete.

### 2.2 Install the package

```bash
npm install @microsoft/agents-a365-notifications
```

Confirm the package appears in `package.json` dependencies.

**Mark task complete: "Install @microsoft/agents-a365-notifications"**

---

## Phase 3 — Wire onAgentNotification Handler in Constructor

**Mark task in progress: "Wire onAgentNotification handler in constructor"**

### 3.1 Add side-effect import

**Read** `agentFile`. **Grep** `import '@microsoft/agents-a365-notifications'` (side-effect form).

If missing, **Edit** `agentFile` to add at the top of the imports block:
```typescript
// A365 Notifications — added by add-notifications skill
import '@microsoft/agents-a365-notifications';
import {
  AgentNotificationActivity,
  NotificationType,
  createEmailResponseActivity,
} from '@microsoft/agents-a365-notifications';
```

> **IMPORTANT:** The bare side-effect import `import '@microsoft/agents-a365-notifications'`
> MUST be present. It registers the activity deserializers that allow the framework to
> parse incoming notification payloads. Without it, `onAgentNotification` will never fire.

Also ensure `ActivityTypes` is imported from `@microsoft/agents-activity` — check existing
imports and add if missing.

### 3.2 Register notification handler in constructor

**Grep** `onAgentNotification` in `agentFile`. If missing, **Edit** `agentFile` to add
inside the constructor, before `onActivity(ActivityTypes.Message, ...)`:

```typescript
// A365 Notifications — added by add-notifications skill
this.onAgentNotification('agents:*', async (
  context: TurnContext,
  state: TurnState,
  agentNotificationActivity: AgentNotificationActivity
) => {
  await this.handleAgentNotificationActivity(context, state, agentNotificationActivity);
});
```

Mark all new lines: `// A365 Notifications — added by add-notifications skill`

**Mark task complete: "Wire onAgentNotification handler in constructor"**

---

## Phase 4 — Implement Email Notification Handler

**Mark task in progress: "Implement email notification handler"**

### 4.1 Add handleAgentNotificationActivity

**Grep** `handleAgentNotificationActivity` in `agentFile`. If missing, **Edit** `agentFile`
to add as a class method:

```typescript
// A365 Notifications — added by add-notifications skill
async handleAgentNotificationActivity(
  context: TurnContext,
  state: TurnState,
  agentNotificationActivity: AgentNotificationActivity
): Promise<void> {
  switch (agentNotificationActivity.notificationType) {
    case NotificationType.EmailNotification:
      await this.handleEmailNotification(context, state, agentNotificationActivity);
      break;
    default:
      await context.sendActivity(
        `Received notification of type: ${agentNotificationActivity.notificationType}`
      );
  }
}
```

### 4.2 Add handleEmailNotification

**Grep** `handleEmailNotification` in `agentFile`. If missing, **Edit** `agentFile` to add:

```typescript
// A365 Notifications — added by add-notifications skill
private async handleEmailNotification(
  context: TurnContext,
  state: TurnState,
  activity: AgentNotificationActivity
): Promise<void> {
  const emailNotification = activity.emailNotification;

  if (!emailNotification) {
    await context.sendActivity(
      createEmailResponseActivity('I could not find the email notification details.')
    );
    return;
  }

  try {
    const client = await getClient(this.authorization, A365Agent.authHandlerName, context);

    const emailContent = await client.invokeInferenceScope(
      `You have a new email from ${context.activity.from?.name} ` +
      `with id '${emailNotification.id}', ` +
      `ConversationId '${emailNotification.conversationId}'. ` +
      `Please retrieve this message and return it in text format.`
    );

    const response = await client.invokeInferenceScope(
      `You have received the following email. Please follow any instructions in it. ${emailContent}`
    );

    await context.sendActivity(
      createEmailResponseActivity(
        response || 'I have processed your email but do not have a response at this time.'
      )
    );
  } catch (error) {
    console.error('Email notification error:', error);
    await context.sendActivity(
      createEmailResponseActivity('Unable to process your email at this time.')
    );
  }
}
```

> **Note:** `getClient` is the per-turn factory from `client.ts` that wires WorkIQ tools.
> If the agent does not have WorkIQ tools wired yet, the email retrieval step will not
> work. Inform the user to run the `add-workiq-tools` skill to add Work IQ Mail.

**Mark task complete: "Implement email notification handler"**

---

## Phase 5 — Wire InstallationUpdate Lifecycle Handler

**Mark task in progress: "Wire InstallationUpdate lifecycle handler"**

### 5.1 Register in constructor

**Grep** `InstallationUpdate` in `agentFile`. If missing, **Edit** `agentFile` to add in
the constructor (after the notification handler, before or after the message handler):

```typescript
// A365 Notifications — added by add-notifications skill
this.onActivity(ActivityTypes.InstallationUpdate, async (
  context: TurnContext,
  state: TurnState
) => {
  await this.handleInstallationUpdateActivity(context, state);
});
```

### 5.2 Add handleInstallationUpdateActivity

**Grep** `handleInstallationUpdateActivity` in `agentFile`. If missing, **Edit** to add:

```typescript
// A365 Notifications — added by add-notifications skill
async handleInstallationUpdateActivity(
  context: TurnContext,
  state: TurnState
): Promise<void> {
  const from = context.activity?.from;
  console.log(
    `InstallationUpdate — Action: '${context.activity.action ?? "(none)"}', ` +
    `DisplayName: '${from?.name ?? "(unknown)"}', UserId: '${from?.id ?? "(unknown)"}'`
  );

  if (context.activity.action === 'add') {
    await context.sendActivity(
      'Thank you for hiring me! Looking forward to assisting you in your professional journey!'
    );
  } else if (context.activity.action === 'remove') {
    await context.sendActivity('Thank you for your time, I enjoyed working with you.');
  }
}
```

**Mark task complete: "Wire InstallationUpdate lifecycle handler"**

---

## Phase 6 — Validate Build

**Mark task in progress: "Validate build"**

```bash
npm install
npm run build || npx tsc --noEmit || echo "No build script — checking types only"
```

If build fails, present the error and offer to debug. Do not revert changes.

**Mark task complete: "Validate build"**

---

## Phase 7 — Final Summary

**TaskList** — show all completed tasks.

```
✅ Agent 365 notifications wired!

**Notifications registered:**
  • onAgentNotification('agents:*') → email notification handler ✅
  • onActivity(InstallationUpdate) → welcome / farewell messages ✅

**How notifications work:**
  When a user emails your AI Teammate, Agent 365 delivers an AgentNotificationActivity
  to your /api/messages endpoint. The handler retrieves the email via Work IQ Mail,
  processes it with the LLM, and replies using createEmailResponseActivity().

**Next steps:**
  • Ensure Work IQ Mail is configured (run add-workiq-tools if not already done)
  • Deploy your agent so the messaging endpoint is reachable
  • Test by emailing your agent's address in Microsoft 365
```

---

## Error Handling

| Situation | Action |
|-----------|--------|
| `Cannot find module '@microsoft/agents-a365-notifications'` | Run `npm install @microsoft/agents-a365-notifications` |
| `onAgentNotification` is not a function | Check `@microsoft/agents-hosting` version — requires 1.2.x+ |
| Notifications not received after deploy | Verify messaging endpoint is registered (`a365 config display -g`) |
| `emailNotification` is undefined | Check that the side-effect import is present — required for deserialization |
| Email reply not delivered as email | Verify you are using `createEmailResponseActivity(text)` not plain `sendActivity(text)` |
| No WorkIQ Mail tools available | Run `add-workiq-tools` skill to add Work IQ Mail |

---

## References

- **Agent Detection:** `${CLAUDE_PLUGIN_ROOT}/shared/agent-detection.md`
- **Node.js Patterns:** `${CLAUDE_PLUGIN_ROOT}/skills/add-notifications/references/nodejs-notifications.md`
- **WorkIQ Tools:** run the `add-workiq-tools` skill to add Work IQ Mail for email retrieval
