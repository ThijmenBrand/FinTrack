"use client";
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Drawer as VaulDrawer } from "vaul";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(false);
  React.useEffect(() => {
    const mql = window.matchMedia("(max-width: 639px)");
    const onChange = (e: MediaQueryListEvent | MediaQueryList) =>
      setIsMobile(e.matches);
    onChange(mql);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}

// ── Desktop Dialog (Radix) ──────────────────────────────────────────

const DesktopDialog = DialogPrimitive.Root;
const DesktopDialogPortal = DialogPrimitive.Portal;
const DesktopDialogClose = DialogPrimitive.Close;
const DesktopDialogTrigger = DialogPrimitive.Trigger;

const DesktopDialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
));
DesktopDialogOverlay.displayName = "DesktopDialogOverlay";

const DesktopDialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DesktopDialogPortal>
    <DesktopDialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed z-50 w-full max-w-lg border border-input bg-background p-5 sm:p-6 shadow-lg duration-200",
        "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg",
        "max-h-[85vh] overflow-hidden flex flex-col",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        "data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]",
        "data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
        className
      )}
      {...props}
    >
      <div className="overflow-y-auto overflow-x-hidden flex-1 min-h-0 grid gap-4 [&>*]:min-w-0">
        {children}
      </div>
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DesktopDialogPortal>
));
DesktopDialogContent.displayName = "DesktopDialogContent";

// ── Mobile Drawer (Vaul) ────────────────────────────────────────────

const MobileDrawer = VaulDrawer.Root;
const MobileDrawerPortal = VaulDrawer.Portal;
const MobileDrawerClose = VaulDrawer.Close;
const MobileDrawerTrigger = VaulDrawer.Trigger;

const MobileDrawerOverlay = React.forwardRef<
  React.ComponentRef<typeof VaulDrawer.Overlay>,
  React.ComponentPropsWithoutRef<typeof VaulDrawer.Overlay>
>(({ className, ...props }, ref) => (
  <VaulDrawer.Overlay
    ref={ref}
    className={cn("fixed inset-0 z-50 bg-black/80", className)}
    {...props}
  />
));
MobileDrawerOverlay.displayName = "MobileDrawerOverlay";

const MobileDrawerContent = React.forwardRef<
  React.ComponentRef<typeof VaulDrawer.Content>,
  React.ComponentPropsWithoutRef<typeof VaulDrawer.Content> & {
    children?: React.ReactNode;
  }
>(({ className, children, ...props }, ref) => (
  <MobileDrawerPortal>
    <MobileDrawerOverlay />
    <VaulDrawer.Content
      ref={ref}
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl border-t bg-background shadow-lg max-h-[85vh]",
        className
      )}
      {...props}
    >
      <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-muted-foreground/30" />
      <div className="overflow-y-auto overflow-x-hidden flex-1 min-h-0 p-5 grid gap-4 [&>*]:min-w-0">
        {children}
      </div>
    </VaulDrawer.Content>
  </MobileDrawerPortal>
));
MobileDrawerContent.displayName = "MobileDrawerContent";

// ── Responsive Dialog ───────────────────────────────────────────────

interface DialogProps {
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const Dialog = ({ children, ...props }: DialogProps) => {
  const isMobile = useIsMobile();
  if (isMobile) {
    return <MobileDrawer {...props}>{children}</MobileDrawer>;
  }
  return <DesktopDialog {...props}>{children}</DesktopDialog>;
};
Dialog.displayName = "Dialog";

const DialogTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Trigger>
>((props, ref) => {
  const isMobile = useIsMobile();
  if (isMobile) return <MobileDrawerTrigger ref={ref} {...props} />;
  return <DesktopDialogTrigger ref={ref} {...props} />;
});
DialogTrigger.displayName = "DialogTrigger";

const DialogClose = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Close>
>((props, ref) => {
  const isMobile = useIsMobile();
  if (isMobile) return <MobileDrawerClose ref={ref} {...props} />;
  return <DesktopDialogClose ref={ref} {...props} />;
});
DialogClose.displayName = "DialogClose";

const DialogContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ children, ...props }, ref) => {
  const isMobile = useIsMobile();
  if (isMobile)
    return (
      <MobileDrawerContent ref={ref} {...props}>
        {children}
      </MobileDrawerContent>
    );
  return (
    <DesktopDialogContent ref={ref} {...props}>
      {children}
    </DesktopDialogContent>
  );
});
DialogContent.displayName = "DialogContent";

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <VaulDrawer.Title
        ref={ref}
        className={cn("text-lg font-semibold leading-none tracking-tight", className)}
        {...props}
      />
    );
  }
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn("text-lg font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  );
});
DialogTitle.displayName = "DialogTitle";

const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <VaulDrawer.Description
        ref={ref}
        className={cn("text-sm text-muted-foreground", className)}
        {...(props as React.ComponentPropsWithoutRef<typeof VaulDrawer.Description>)}
      />
    );
  }
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
});
DialogDescription.displayName = "DialogDescription";

const DialogPortal = DialogPrimitive.Portal;
const DialogOverlay = DesktopDialogOverlay;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
