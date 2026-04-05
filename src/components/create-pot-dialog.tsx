"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { useCreatePot } from "@/hooks/use-pots";
import type { Category } from "@/types/api";

interface CreatePotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[];
  onCreated: () => void;
}

export function CreatePotDialog({
  open,
  onOpenChange,
  categories,
  onCreated,
}: CreatePotDialogProps) {
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const createPot = useCreatePot();

  const handleCreate = async () => {
    if (!name.trim()) return;
    try {
      await createPot.mutateAsync({ name: name.trim(), categoryId: categoryId || null });
      setName("");
      setCategoryId("");
      onCreated();
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to create pot:", err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Pot</DialogTitle>
          <DialogDescription>
            Group related transactions (e.g. a weekend trip) into a pot. The pot&apos;s net amount counts in summaries.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pot-name">Name</Label>
            <Input
              id="pot-name"
              placeholder="e.g. Weekend trip Amsterdam"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue placeholder="Select category (optional)" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    <span className="flex items-center gap-2">
                      {cat.color && (
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: cat.color }}
                        />
                      )}
                      {cat.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!name.trim() || createPot.isPending}>
            {createPot.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Create Pot
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
