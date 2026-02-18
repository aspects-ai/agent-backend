"""Interactive CLI chat harness — handles input, streaming, and message history."""

import json
import os
import sys
from typing import Any

from openai import OpenAI


def mcp_tools_to_openai(mcp_tools: list[Any]) -> list[dict[str, Any]]:
    """Convert MCP tool definitions to OpenAI function-calling format."""
    openai_tools = []
    for tool in mcp_tools:
        openai_tools.append({
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description or "",
                "parameters": tool.inputSchema
                if tool.inputSchema
                else {"type": "object", "properties": {}},
            },
        })
    return openai_tools


async def run_chat(
    model: str,
    mcp_tools: list[Any],
    session: Any,
) -> None:
    """Run an interactive chat loop with streaming and tool execution."""
    client = OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=os.environ["OPENROUTER_API_KEY"],
    )

    openai_tools = mcp_tools_to_openai(mcp_tools)
    messages: list[dict[str, Any]] = []

    print('Type "exit" to quit.\n')

    while True:
        try:
            user_input = input("you> ")
        except (EOFError, KeyboardInterrupt):
            break

        if user_input.strip().lower() == "exit":
            break
        if not user_input.strip():
            continue

        messages.append({"role": "user", "content": user_input})
        sys.stdout.write("\n...\r")
        sys.stdout.flush()

        # Agentic loop — max 15 steps
        for _step in range(15):
            stream = client.chat.completions.create(
                model=model,
                messages=messages,
                tools=openai_tools or None,
                stream=True,
            )

            assistant_content = ""
            tool_calls_map: dict[int, dict[str, str]] = {}
            has_output = False

            for chunk in stream:
                delta = chunk.choices[0].delta if chunk.choices else None
                if not delta:
                    continue

                # Text content
                if delta.content:
                    if not has_output:
                        sys.stdout.write("\x1b[2K\rassistant> ")
                        has_output = True
                    sys.stdout.write(delta.content)
                    sys.stdout.flush()
                    assistant_content += delta.content

                # Tool calls (accumulated across chunks)
                if delta.tool_calls:
                    for tc in delta.tool_calls:
                        idx = tc.index
                        if idx not in tool_calls_map:
                            tool_calls_map[idx] = {"id": "", "name": "", "arguments": ""}
                        if tc.id:
                            tool_calls_map[idx]["id"] = tc.id
                        if tc.function and tc.function.name:
                            tool_calls_map[idx]["name"] = tc.function.name
                        if tc.function and tc.function.arguments:
                            tool_calls_map[idx]["arguments"] += tc.function.arguments

            # Build assistant message
            tool_calls_list = []
            if tool_calls_map:
                for idx in sorted(tool_calls_map):
                    tc = tool_calls_map[idx]
                    tool_calls_list.append({
                        "id": tc["id"],
                        "type": "function",
                        "function": {
                            "name": tc["name"],
                            "arguments": tc["arguments"],
                        },
                    })

            assistant_msg: dict[str, Any] = {"role": "assistant"}
            if assistant_content:
                assistant_msg["content"] = assistant_content
            if tool_calls_list:
                assistant_msg["tool_calls"] = tool_calls_list
            messages.append(assistant_msg)

            # No tool calls — done with this turn
            if not tool_calls_list:
                break

            # Execute tool calls
            if not has_output:
                sys.stdout.write("\x1b[2K\r")
                has_output = True

            for tc in tool_calls_list:
                name = tc["function"]["name"]
                args_str = tc["function"]["arguments"]
                args = json.loads(args_str) if args_str else {}

                sys.stdout.write(f"  [{name}] {json.dumps(args)[:120]}\n")
                sys.stdout.flush()

                result = await session.call_tool(name, args)

                # Extract text from result content
                result_text = ""
                for content in result.content:
                    if hasattr(content, "text"):
                        result_text += content.text
                    else:
                        result_text += str(content)

                if len(result_text) > 200:
                    sys.stdout.write(f"\n  => {result_text[:200]}...")
                else:
                    sys.stdout.write(f"\n  => {result_text}")
                sys.stdout.flush()

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": result_text,
                })

        sys.stdout.write("\n\n")
        sys.stdout.flush()
