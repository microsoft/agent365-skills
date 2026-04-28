# Node.js LangChain — A365 Notifications Reference

Authoritative patterns for wiring Agent 365 notifications and lifecycle events into a
Node.js LangChain AI Teammate agent. Mirrors the Agent365-Samples langchain sample.

---

## npm Package

| Package | Purpose |
|---------|---------|
| `@microsoft/agents-a365-notifications` | `AgentNotificationActivity`, `NotificationType`, `createEmailResponseActivity` |

```bash
npm install @microsoft/agents-a365-notifications
```

---

## agent.ts — Full Wiring Pattern

```typescript
// Side-effect import — registers notification activity deserializers
import '@microsoft/agents-a365-notifications';
import {
  AgentNotificationActivity,
  NotificationType,
  createEmailResponseActivity,
} from '@microsoft/agents-a365-notifications';
import { TurnContext, TurnState, AgentApplication } from '@microsoft/agents-hosting';
import { Activity, ActivityTypes } from '@microsoft/agents-activity';

export class A365Agent extends AgentApplication<TurnState> {
  constructor() {
    super({ /* ... existing config ... */ });

    // ── A365 Notifications: route incoming agent notifications ────────────────
    this.onAgentNotification('agents:*', async (
      context: TurnContext,
      state: TurnState,
      agentNotificationActivity: AgentNotificationActivity
    ) => {
      await this.handleAgentNotificationActivity(context, state, agentNotificationActivity);
    });
    // ─────────────────────────────────────────────────────────────────────────

    // ── A365 Notifications: handle install / uninstall lifecycle events ───────
    this.onActivity(ActivityTypes.InstallationUpdate, async (
      context: TurnContext,
      state: TurnState
    ) => {
      await this.handleInstallationUpdateActivity(context, state);
    });
    // ─────────────────────────────────────────────────────────────────────────

    this.onActivity(ActivityTypes.Message, async (context, state) => {
      await this.handleAgentMessageActivity(context, state);
    });
  }

  // ── A365 Notifications: dispatch by notification type ──────────────────────
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

  // ── A365 Notifications: email notification handler ─────────────────────────
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

      // Step 1: retrieve the email content via WorkIQ Mail tool
      const emailContent = await client.invokeInferenceScope(
        `You have a new email from ${context.activity.from?.name} ` +
        `with id '${emailNotification.id}', ` +
        `ConversationId '${emailNotification.conversationId}'. ` +
        `Please retrieve this message and return it in text format.`
      );

      // Step 2: process instructions in the email
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

  // ── A365 Notifications: install / uninstall lifecycle ─────────────────────
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
}
```

---

## Key Types

### `AgentNotificationActivity`

| Field | Type | Description |
|-------|------|-------------|
| `notificationType` | `NotificationType` | Enum value indicating the notification kind |
| `emailNotification` | `EmailNotification \| undefined` | Present when `notificationType === EmailNotification` |

### `EmailNotification`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Email message ID — pass to WorkIQ Mail tool to retrieve content |
| `conversationId` | `string` | Thread/conversation ID |

### `NotificationType` enum

| Value | Description |
|-------|-------------|
| `NotificationType.EmailNotification` | An email arrived and triggered the agent |

### `createEmailResponseActivity(text: string)`

Returns an `Activity` object formatted as an email reply. Always use this helper (instead of
`sendActivity(text)`) when responding to an email notification — it sets the correct activity
type so A365 routes the reply back as an email response.

---

## Registration Handler Pattern

```typescript
this.onAgentNotification('agents:*', async (context, state, agentNotificationActivity) => {
  // 'agents:*' is a wildcard — catches all A365 notification types
  await this.handleAgentNotificationActivity(context, state, agentNotificationActivity);
});
```

The `'agents:*'` pattern is the correct wildcard. Do not use a more specific route unless
you want to filter to a single notification type at the registration level.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Notification handler never fires | Side-effect import missing | Add `import '@microsoft/agents-a365-notifications';` at the top of the file |
| `agentNotificationActivity.emailNotification` is undefined | `notificationType` is not `EmailNotification` | Add a `default` case to handle unexpected types gracefully |
| `createEmailResponseActivity` not found | Package not installed | Run `npm install @microsoft/agents-a365-notifications` |
| Install/uninstall event not received | `onActivity(ActivityTypes.InstallationUpdate, ...)` not registered | Register the handler in the constructor |
| Email reply not delivered | Used `sendActivity(text)` instead of `createEmailResponseActivity` | Wrap response in `createEmailResponseActivity(text)` |
