"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { LUCIDE_ICON_MAP, LUCIDE_ICON_SECTIONS } from "@/components/category-icon";

const EMOJI_SECTIONS = [
  {
    label: "Food & Drink",
    emojis: ["🛒", "🍕", "🍔", "☕", "🍺", "🍷", "🥗", "🍽️", "🧁"],
  },
  {
    label: "Transport",
    emojis: ["🚗", "🚌", "🚲", "✈️", "⛽", "🚕", "🚆", "🚶"],
  },
  {
    label: "Home & Utilities",
    emojis: ["🏠", "💡", "🔧", "🧹", "📱", "💻", "📦", "🔌"],
  },
  {
    label: "Money & Work",
    emojis: ["💰", "💳", "🏦", "💵", "📈", "💼", "🧾", "💸"],
  },
  {
    label: "Health & Fitness",
    emojis: ["❤️", "💊", "🏥", "🏋️", "🧘"],
  },
  {
    label: "Entertainment",
    emojis: ["🎬", "🎮", "🎵", "📚", "🎭", "🎯", "🎨"],
  },
  {
    label: "Shopping & Personal",
    emojis: ["👕", "🛍️", "💇", "🎁", "✂️", "👟"],
  },
  {
    label: "Other",
    emojis: ["📌", "🔄", "❓", "⭐", "🏷️", "📎", "🗂️"],
  },
];

interface IconPickerProps {
  value: string | null;
  onSelect: (icon: string | null) => void;
}

export function EmojiPicker({ value, onSelect }: IconPickerProps) {
  const [tab, setTab] = useState<"emoji" | "icon">(
    value && value.codePointAt(0)! <= 255 ? "icon" : "emoji"
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-md border p-0.5">
          <button
            type="button"
            className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
              tab === "emoji" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setTab("emoji")}
          >
            Emoji
          </button>
          <button
            type="button"
            className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
              tab === "icon" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setTab("icon")}
          >
            Icons
          </button>
        </div>
        {value && (
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => onSelect(null)}
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        )}
      </div>

      {tab === "emoji" ? (
        <>
          {EMOJI_SECTIONS.map((section) => (
            <div key={section.label}>
              <p className="text-xs text-muted-foreground mb-1.5">{section.label}</p>
              <div className="flex flex-wrap gap-1">
                {section.emojis.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className={`w-9 h-9 flex items-center justify-center rounded-md text-lg hover:bg-accent transition-colors ${
                      value === emoji ? "ring-2 ring-ring bg-accent" : ""
                    }`}
                    onClick={() => onSelect(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </>
      ) : (
        <>
          {LUCIDE_ICON_SECTIONS.map((section) => (
            <div key={section.label}>
              <p className="text-xs text-muted-foreground mb-1.5">{section.label}</p>
              <div className="flex flex-wrap gap-1">
                {section.icons.map((iconName) => {
                  const IconComp = LUCIDE_ICON_MAP[iconName];
                  if (!IconComp) return null;
                  return (
                    <button
                      key={iconName}
                      type="button"
                      className={`w-9 h-9 flex items-center justify-center rounded-md hover:bg-accent transition-colors ${
                        value === iconName ? "ring-2 ring-ring bg-accent" : ""
                      }`}
                      onClick={() => onSelect(iconName)}
                      title={iconName.replace(/([A-Z])/g, " $1").trim()}
                    >
                      <IconComp className="h-4 w-4" />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
