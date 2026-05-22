import { FunctionDeclaration, SchemaType } from "@google/genai";

export const sandboxTools: FunctionDeclaration[] = [
  {
    name: "execute_shell_command",
    description: "Execute a shell command on the host system. Use this to perform system-level tasks, manage files, or run scripts. ALWAYS use this when the Boss asks for system operations or when you need to interact with the VPS environment.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        command: {
          type: SchemaType.STRING,
          description: "The shell command to execute (e.g., 'ls -la', 'npm start', 'ps aux').",
        },
      },
      required: ["command"],
    },
  },
];
