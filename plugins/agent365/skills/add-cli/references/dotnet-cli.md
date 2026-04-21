# .NET AgentFramework — CLI Runner Pattern

Reference for the `add-cli` skill. All scaffolded code must be marked:
`// A365 CLI — added by add-cli skill`

---

## ConsoleCli.cs — Full Pattern

```csharp
// A365 CLI — added by add-cli skill
using Microsoft.Agents.Builder;
using Microsoft.Agents.Core.Models;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using System;
using System.Threading;
using System.Threading.Tasks;

namespace MyAgent
{
    // A365 CLI — added by add-cli skill
    /// <summary>
    /// Interactive console runner for local agent testing. No HTTP stack required.
    /// Run: dotnet run --cli
    /// </summary>
    public static class ConsoleCli
    {
        // A365 CLI — added by add-cli skill
        public static async Task RunAsync(IHost host, CancellationToken cancellationToken = default)
        {
            var agent = host.Services.GetRequiredService<MyAgent>(); // replace with actual agent class
            var adapter = host.Services.GetRequiredService<IChannelAdapter>();

            Console.WriteLine("A365 Agent CLI — type a message, Ctrl+C to exit");
            Console.WriteLine("──────────────────────────────────────────────────");

            // A365 CLI — added by add-cli skill
            while (!cancellationToken.IsCancellationRequested)
            {
                Console.Write("You: ");
                var input = Console.ReadLine();
                if (input == null) break;
                if (string.IsNullOrWhiteSpace(input)) continue;

                // A365 CLI — added by add-cli skill
                var activity = new Activity
                {
                    Type = ActivityTypes.Message,
                    Text = input,
                    From = new ChannelAccount { Id = "cli-user", Name = "CLI User" },
                    Recipient = new ChannelAccount { Id = "agent", Name = "Agent" },
                    Conversation = new ConversationAccount { Id = "cli-session" },
                    ChannelId = "console",
                    ServiceUrl = "http://localhost"
                };

                // A365 CLI — added by add-cli skill
                await adapter.ProcessActivityAsync(activity, async (context, ct) =>
                {
                    await agent.OnTurnAsync(context, ct).ConfigureAwait(false);
                }, cancellationToken).ConfigureAwait(false);

                Console.WriteLine();
            }

            Console.WriteLine("Goodbye.");
        }
    }
}
```

---

## Program.cs — CLI Mode Check

Add at the top of `Program.cs`, after the host is built but before `app.Run()`:

```csharp
// A365 CLI — added by add-cli skill
var runMode = args.Contains("--cli")
    ? "cli"
    : Environment.GetEnvironmentVariable("RUN_MODE") ?? "http";

if (runMode == "cli")
{
    // A365 CLI — added by add-cli skill
    using var cts = new CancellationTokenSource();
    Console.CancelKeyPress += (_, e) =>
    {
        e.Cancel = true;
        cts.Cancel();
    };
    await ConsoleCli.RunAsync(app, cts.Token);
    return;
}

// Normal HTTP host — unchanged
app.Run();
```

---

## launchSettings.json — CLI Profile

```json
{
  "profiles": {
    "CLI": {
      "commandName": "Project",
      "commandLineArgs": "--cli",
      "environmentVariables": {
        "ASPNETCORE_ENVIRONMENT": "Development",
        "RUN_MODE": "cli"
      }
    }
  }
}
```

---

## Run Commands

```bash
# Start CLI runner
dotnet run --cli

# Or using launch profile (VS Code)
dotnet run --launch-profile CLI
```

---

## Key Types Reference

| Type | Namespace | Role |
|------|-----------|------|
| `Activity` | `Microsoft.Agents.Core.Models` | Represents a message to/from the agent |
| `ActivityTypes` | `Microsoft.Agents.Core.Models` | Constants for activity type strings |
| `IChannelAdapter` | `Microsoft.Agents.Builder` | Processes activities through the bot pipeline |
| `ChannelAccount` | `Microsoft.Agents.Core.Models` | Identifies user/agent in a conversation |
| `ConversationAccount` | `Microsoft.Agents.Core.Models` | Identifies the conversation |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Agent class not resolved | Verify `builder.Services.AddSingleton<MyAgent>()` in Program.cs |
| `IChannelAdapter` not resolved | Ensure `builder.Services.AddAgentFramework()` is called before build |
| Response not printed | Ensure agent calls `context.SendActivityAsync()` — CLI output depends on adapter callbacks |
| Ctrl+C hangs | Ensure `CancellationTokenSource.Cancel()` is wired to `Console.CancelKeyPress` |
