import { useEffect, useState } from "react";
import { Loader2, MessageSquare, Trash2, Settings2 } from "lucide-react";
import { toast } from "sonner";
import type { SubagentInfo } from "@nimbus/shared";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { SubagentAvatar, COLORWAYS, colorwayFor } from "@/components/brand/ChatAvatar";

interface SubagentModalProps {
  subagent: SubagentInfo | null;
  isNew?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: { name: string; description: string; prompt: string; avatar?: string; tools?: string[]; model?: string; scope?: "local" | "user" }) => Promise<void>;
  onDelete?: (name: string) => Promise<void>;
  onStartChat?: (subagentName: string) => void;
}

export function SubagentModal({
  subagent,
  isNew = false,
  open,
  onOpenChange,
  onSave,
  onDelete,
  onStartChat,
}: SubagentModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [avatar, setAvatar] = useState("indigo");
  const [toolsStr, setToolsStr] = useState("");
  const [model, setModel] = useState("");
  const [scope, setScope] = useState<"local" | "user">("local");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (subagent) {
      setName(subagent.name);
      setDescription(subagent.description);
      setPrompt(subagent.prompt || "");
      setAvatar(subagent.avatar || colorwayFor(subagent.name).id);
      setToolsStr(subagent.tools?.join(", ") || "");
      setModel(subagent.model || "");
      setScope(subagent.scope === "user" ? "user" : "local");
      setShowAdvanced(Boolean(subagent.tools?.length || subagent.model));
    } else {
      setName("");
      setDescription("");
      setPrompt("");
      setAvatar("indigo");
      setToolsStr("");
      setModel("");
      setScope("local");
      setShowAdvanced(false);
    }
  }, [subagent, open]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/^-+|-+$/g, "");
    if (!cleanName) {
      toast.error("Please enter a valid subagent name");
      return;
    }
    if (!description.trim()) {
      toast.error("Please provide a short description");
      return;
    }
    if (!prompt.trim()) {
      toast.error("Please provide instructions / system prompt");
      return;
    }

    const tools = toolsStr
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    setSaving(true);
    try {
      await onSave({
        name: cleanName,
        description: description.trim(),
        prompt: prompt.trim(),
        avatar,
        tools: tools.length > 0 ? tools : undefined,
        model: model.trim() || undefined,
        scope,
      });
      toast.success(isNew ? `Created subagent “${cleanName}”` : `Updated subagent “${cleanName}”`);
      onOpenChange(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!subagent || !onDelete) return;
    if (!confirm(`Are you sure you want to delete “${subagent.name}”?`)) return;
    setDeleting(true);
    try {
      await onDelete(subagent.name);
      toast.success(`Deleted subagent “${subagent.name}”`);
      onOpenChange(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const isBuiltin = subagent?.scope === "builtin";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={handleSave}>
          <DialogHeader className="mb-3">
            <div className="flex items-center gap-3">
              <SubagentAvatar seed={name || subagent?.name || "subagent"} avatar={avatar} size={42} className="shadow-xs" />
              <div>
                <DialogTitle className="text-lg font-semibold flex items-center gap-2">
                  {isNew ? "Create Subagent" : `Edit ${subagent?.name}`}
                  {subagent && (
                    <span
                      className={cn(
                        "rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                        subagent.scope === "builtin"
                          ? "bg-muted text-muted-foreground"
                          : "bg-primary/15 text-primary"
                      )}
                    >
                      {subagent.scope ?? "custom"}
                    </span>
                  )}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {isBuiltin
                    ? "Editing this built-in subagent saves a customized override in your workspace."
                    : "Configure instructions, tools, avatar theme, and behavior for this subagent."}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {/* Subagent Avatar & Colorway Theme Picker */}
          <div className="mb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-2xl border border-border/70 bg-muted/20 p-3">
            <div className="flex items-center gap-3">
              <SubagentAvatar seed={name || subagent?.name || "preview"} avatar={avatar} size={44} className="shadow-xs ring-2 ring-primary/20" />
              <div>
                <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <span>Profile Picture &amp; Theme</span>
                  <span className="font-mono text-[10px] text-muted-foreground font-normal">
                    ({COLORWAYS.find((c) => c.id === avatar)?.name ?? avatar})
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">Select a mascot colorway for this subagent</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {COLORWAYS.map((c) => {
                const isSelected = avatar.toLowerCase() === c.id.toLowerCase();
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setAvatar(c.id)}
                    title={c.name}
                    className={cn(
                      "group relative flex size-7 items-center justify-center rounded-lg border transition-all cursor-pointer",
                      isSelected
                        ? "border-primary ring-2 ring-primary/30 scale-110 shadow-xs"
                        : "border-border/60 hover:border-foreground/40 hover:scale-105 opacity-80 hover:opacity-100"
                    )}
                    style={{ background: c.bg }}
                  >
                    <span
                      className="size-3 rounded-full shadow-xs"
                      style={{
                        background: `linear-gradient(135deg, ${c.palette[0]}, ${c.palette[1]})`,
                      }}
                    />
                    {isSelected && (
                      <span className="absolute -top-1 -right-1 flex size-2 items-center justify-center rounded-full bg-primary" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-4 py-1">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="subagent-name" className="text-xs font-medium">
                  Subagent Name
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-muted-foreground">
                    /
                  </span>
                  <Input
                    id="subagent-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={!isNew && isBuiltin}
                    placeholder="e.g. code-auditor"
                    className="pl-6 font-mono text-sm"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="subagent-desc" className="text-xs font-medium">
                  Description
                </Label>
                <Input
                  id="subagent-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Short tagline shown in / popup"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="subagent-prompt" className="text-xs font-medium">
                  System Prompt &amp; Instructions
                </Label>
                <span className="text-[11px] text-muted-foreground">
                  Defines role, behavior &amp; output style
                </span>
              </div>
              <Textarea
                id="subagent-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={9}
                placeholder="You are an autonomous subagent specialized in... Give concrete instructions on how to handle requests, what tools to prioritize, and what format to return."
                className="font-mono text-xs leading-relaxed"
                required
              />
            </div>

            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <Settings2 className="size-3.5" />
                <span>{showAdvanced ? "Hide Advanced Settings" : "Show Advanced Settings (Tools, Model, Scope)"}</span>
              </button>
            </div>

            {showAdvanced && (
              <div className="space-y-3 rounded-xl border bg-muted/30 p-3">
                <div className="space-y-1.5">
                  <Label htmlFor="subagent-tools" className="text-xs font-medium">
                    Allowed Tools (Comma-separated)
                  </Label>
                  <Input
                    id="subagent-tools"
                    value={toolsStr}
                    onChange={(e) => setToolsStr(e.target.value)}
                    placeholder="e.g. run_terminal_cmd, read_file, grep, list_dir"
                    className="text-xs font-mono"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Leave blank to inherit safe standard subagent tools.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="subagent-model" className="text-xs font-medium">
                      Model Override (Optional)
                    </Label>
                    <Input
                      id="subagent-model"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder="e.g. deepseek-reasoner"
                      className="text-xs font-mono"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Save Scope</Label>
                    <div className="flex gap-2 pt-1">
                      <Button
                        type="button"
                        size="sm"
                        variant={scope === "local" ? "default" : "outline"}
                        className="flex-1 text-xs"
                        onClick={() => setScope("local")}
                      >
                        Workspace (.nimbus)
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={scope === "user" ? "default" : "outline"}
                        className="flex-1 text-xs"
                        onClick={() => setScope("user")}
                      >
                        Global User (~/.nimbus)
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="mt-5 flex items-center justify-between gap-2 border-t pt-3 sm:justify-between">
            <div>
              {!isNew && !isBuiltin && onDelete && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={handleDelete}
                  disabled={deleting || saving}
                >
                  {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                  Delete
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {!isNew && onStartChat && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    onOpenChange(false);
                    onStartChat(name);
                  }}
                >
                  <MessageSquare className="size-3.5" />
                  Chat with /{name}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={saving || deleting}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={saving || deleting}>
                {saving && <Loader2 className="size-3.5 animate-spin mr-1.5" />}
                {isNew ? "Create Subagent" : "Save Changes"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
