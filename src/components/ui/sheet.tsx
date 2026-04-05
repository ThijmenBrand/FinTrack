"use client";

import * as React from "react";
import { Drawer as VaulDrawer } from "vaul";
import { cn } from "@/lib/utils";

const Sheet = ({
  ...props
}: React.ComponentProps<typeof VaulDrawer.Root>) => (
  <VaulDrawer.Root {...props} />
);
Sheet.displayName = "Sheet";

const SheetTrigger = VaulDrawer.Trigger;
const SheetClose = VaulDrawer.Close;
const SheetPortal = VaulDrawer.Portal;

const SheetOverlay = React.forwardRef<
  React.ComponentRef<typeof VaulDrawer.Overlay>,
  React.ComponentPropsWithoutRef<typeof VaulDrawer.Overlay>
>(({ className, ...props }, ref) => (
  <VaulDrawer.Overlay
    ref={ref}
    className={cn("fixed inset-0 z-50 bg-black/80", className)}
    {...props}
  />
));
SheetOverlay.displayName = "SheetOverlay";

const SheetContent = React.forwardRef<
  React.ComponentRef<typeof VaulDrawer.Content>,
  React.ComponentPropsWithoutRef<typeof VaulDrawer.Content>
>(({ className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <VaulDrawer.Content
      ref={ref}
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl border-t bg-background shadow-lg",
        className
      )}
      {...props}
    >
      <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-muted-foreground/30" />
      {children}
    </VaulDrawer.Content>
  </SheetPortal>
));
SheetContent.displayName = "SheetContent";

const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col space-y-2 px-6 pt-4 pb-2 text-left", className)}
    {...props}
  />
);
SheetHeader.displayName = "SheetHeader";

const SheetTitle = React.forwardRef<
  React.ComponentRef<typeof VaulDrawer.Title>,
  React.ComponentPropsWithoutRef<typeof VaulDrawer.Title>
>(({ className, ...props }, ref) => (
  <VaulDrawer.Title
    ref={ref}
    className={cn("text-lg font-semibold", className)}
    {...props}
  />
));
SheetTitle.displayName = "SheetTitle";

const SheetDescription = React.forwardRef<
  React.ComponentRef<typeof VaulDrawer.Description>,
  React.ComponentPropsWithoutRef<typeof VaulDrawer.Description>
>(({ className, ...props }, ref) => (
  <VaulDrawer.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
SheetDescription.displayName = "SheetDescription";

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetPortal,
  SheetOverlay,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
};
