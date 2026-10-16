import type { ToolDefinition } from "../types.js";

interface RenderUiArgs {
  /** Descriptive title for the interactive widget or tool (e.g. "Mortgage Calculator", "Cost Comparison", "3D Solar System"). */
  title: string;
  /**
   * Complete, standalone interactive HTML markup including any inline CSS (<style>) and JavaScript (<script>).
   * Modern HTML5, Canvas, SVG, CSS Grid/Flexbox, or popular CDNs (e.g. Chart.js, Three.js) are supported.
   * The UI runs in a safe sandboxed iframe with auto-theming (light/dark mode variables).
   */
  html: string;
  /** Optional short explanation or instructions on how to use the widget. */
  description?: string;
  /** Suggested initial height in pixels (e.g. 360, 480). Defaults to 400. */
  height?: number;
}

export const renderUiTool: ToolDefinition<RenderUiArgs> = {
  id: "render_ui",
  title: "render_ui",
  category: "workflow",
  description: [
    "Render a live, interactive UI widget, tool, calculator, data visualization, or mini-app directly in the user's chat.",
    "Use this whenever an answer is best understood by interacting with it (e.g. mortgage/loan/tip calculators, comparison charts, interactive sliders, data explorers, 3D simulations, interactive planners).",
    "Provide self-contained, beautifully styled HTML/CSS/JS that works immediately upon rendering.",
    "The widget inherits CSS custom properties: --background, --foreground, --primary, --muted, --border, and dark mode class.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Title of the interactive widget or tool." },
      html: {
        type: "string",
        description:
          "Complete HTML/CSS/JS document or markup snippet to render inside the interactive iframe sandbox.",
      },
      description: { type: "string", description: "Optional short text explaining the widget." },
      height: { type: "number", description: "Initial height in pixels (e.g. 360, 480). Defaults to 400." },
    },
    required: ["title", "html"],
  },
  permission: null,
  readOnly: true,
  summarize: (a) => `render: ${a.title}`,
  permissionSubject: (a) => a.title,
  async execute(args) {
    const { title, html, description, height } = args;
    if (!title || !html) {
      return { output: "render_ui requires both a title and html content.", isError: true };
    }

    const safeHeight = Math.min(Math.max(Number(height) || 400, 200), 1000);

    return {
      output: `Rendered interactive widget: "${title}". The user can now interact with it directly in their chat.`,
      display: {
        kind: "ui",
        title,
        html,
        description,
        height: safeHeight,
      },
    };
  },
};
