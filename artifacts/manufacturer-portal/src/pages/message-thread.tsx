import { useEffect, useMemo, useRef, useState } from "react";
import {
  useGetThreadMessages, useListManufacturerThreads, useSendThreadMessage, useUploadManufacturerThreadAttachment,
  getGetThreadMessagesQueryKey, getListManufacturerThreadsQueryKey, type Message,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, FileText, ImagePlus, Info, Loader2, MessageSquare, Plus, Send, X } from "lucide-react";
import { orderStatusLabel } from "@workspace/manufacturer-flow";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { EmptyState, QueryError } from "@/components/query-state";
import { ThreadCall } from "@/components/thread-call";
import { OrderCard } from "@/components/orders/order-card";
import { SendCardDialog } from "@/components/orders/send-card-dialog";
import type { OrderCardSnapshot } from "@/lib/order-types";

type RichMessage = Message & { order?: OrderCardSnapshot | null };

const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

function dayLabel(date: Date) {
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

type PendingFile = { file: File; preview: string | null };

export default function MessageThread({ threadId }: { threadId: string }) {
  const messagesQuery = useGetThreadMessages(threadId, { query: { enabled: !!threadId, queryKey: getGetThreadMessagesQueryKey(threadId), refetchInterval: 10_000 } });
  const threadsQuery = useListManufacturerThreads({ query: { queryKey: getListManufacturerThreadsQueryKey(), refetchInterval: 10_000 } });
  const messages = messagesQuery.data as RichMessage[] | undefined;
  const sendMutation = useSendThreadMessage();
  const uploadMutation = useUploadManufacturerThreadAttachment();
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<PendingFile[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const endOfMessagesRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef<string | null>(null);
  const lastCount = useRef(0);

  const thread = threadsQuery.data?.find((t) => t.id === threadId);

  useEffect(() => {
    // Follow new messages without yanking the view on every poll.
    if (messages && messages.length !== lastCount.current) {
      endOfMessagesRef.current?.scrollIntoView({ behavior: lastCount.current === 0 ? "auto" : "smooth", block: "nearest" });
      lastCount.current = messages.length;
    }
  }, [messages]);

  useEffect(() => () => attachments.forEach((item) => item.preview && URL.revokeObjectURL(item.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const grouped = useMemo(() => {
    const groups: Array<{ day: string; items: RichMessage[] }> = [];
    for (const message of messages ?? []) {
      const day = dayLabel(new Date(message.sentAt));
      const current = groups.at(-1);
      if (current?.day === day) current.items.push(message);
      else groups.push({ day, items: [message] });
    }
    return groups;
  }, [messages]);

  const addFiles = (files: FileList | null) => {
    setAttachError(null);
    if (!files) return;
    const next = [...attachments];
    for (const file of Array.from(files)) {
      if (!ACCEPTED.includes(file.type)) { setAttachError("Attach JPEG, PNG, WebP photos or PDF files."); continue; }
      if (file.size > MAX_ATTACHMENT_BYTES) { setAttachError(`${file.name} is larger than 20 MB.`); continue; }
      if (next.length >= MAX_ATTACHMENTS) { setAttachError(`You can attach up to ${MAX_ATTACHMENTS} files at once.`); break; }
      next.push({ file, preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null });
    }
    setAttachments(next);
  };

  const removeAttachment = (index: number) => {
    setAttachments((items) => {
      const removed = items[index];
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      return items.filter((_, i) => i !== index);
    });
  };

  const handleSend = async () => {
    if ((!draft.trim() && attachments.length === 0) || !threadId || sending) return;
    setSending(true);
    setSendError(null);
    const clientRequestId = requestIdRef.current ?? crypto.randomUUID();
    requestIdRef.current = clientRequestId;
    try {
      const mediaUrls: string[] = [];
      for (const item of attachments) {
        const uploaded = await uploadMutation.mutateAsync({ threadId, data: item.file });
        mediaUrls.push(uploaded.objectPath);
      }
      const onlyImages = attachments.length > 0 && attachments.every((item) => item.file.type.startsWith("image/"));
      const message = await sendMutation.mutateAsync({
        threadId,
        data: {
          clientRequestId,
          content: draft.trim() || (attachments.length ? (onlyImages ? `Sent ${attachments.length === 1 ? "a photo" : `${attachments.length} photos`}` : "Sent an attachment") : undefined),
          messageType: onlyImages ? "image" : "text",
          mediaUrls: mediaUrls.length ? mediaUrls : undefined,
        },
      });
      setDraft("");
      attachments.forEach((item) => item.preview && URL.revokeObjectURL(item.preview));
      setAttachments([]);
      requestIdRef.current = null;
      queryClient.setQueryData(getGetThreadMessagesQueryKey(threadId), (old: Message[] | undefined) =>
        old ? (old.some((item) => item.id === message.id) ? old : [...old, message]) : [message]);
      void queryClient.invalidateQueries({ queryKey: getListManufacturerThreadsQueryKey() });
    } catch {
      setSendError("Message not sent. Check your connection and try again.");
      void queryClient.invalidateQueries({ queryKey: getGetThreadMessagesQueryKey(threadId) });
    } finally {
      setSending(false);
    }
  };

  if (messagesQuery.isLoading || threadsQuery.isLoading) {
    return (
      <div className="flex h-[calc(100vh-8rem)] flex-col rounded-lg border border-border bg-card" data-testid="status-thread-loading">
        <div className="flex h-16 items-center gap-3 border-b border-border px-6">
          <div className="h-10 w-10 animate-pulse rounded-full bg-secondary" />
          <div className="space-y-2"><div className="h-3 w-32 animate-pulse rounded bg-secondary" /><div className="h-3 w-20 animate-pulse rounded bg-secondary" /></div>
        </div>
        <div className="flex-1 space-y-6 p-6">
          <div className="h-16 w-2/3 animate-pulse rounded-lg bg-secondary/50" />
          <div className="ml-auto h-16 w-1/2 animate-pulse rounded-lg bg-secondary/50" />
          <div className="h-40 w-72 animate-pulse rounded-xl bg-secondary/50" />
        </div>
      </div>
    );
  }

  if (messagesQuery.isError || threadsQuery.isError) {
    return (
      <QueryError
        title="Unable to load conversation"
        description="The latest messages could not be retrieved."
        onRetry={() => { void messagesQuery.refetch(); void threadsQuery.refetch(); }}
      />
    );
  }

  if (!thread) {
    return <EmptyState icon={MessageSquare} title="Conversation not found" description="It may have been removed or you may no longer have access." />;
  }

  return (
    <div className="relative flex h-[calc(100vh-8rem)] flex-col overflow-hidden rounded-lg border border-border bg-card animate-in fade-in duration-300">
      <div className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card/80 px-4 backdrop-blur-sm md:px-6">
        <Link href="/messages" className="-ml-2 rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Back to inbox">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-secondary font-bold text-muted-foreground">
            {thread.buyerAvatar ? <img src={thread.buyerAvatar} alt="" className="h-full w-full object-cover" /> : thread.buyerName.substring(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold md:text-base" data-testid="text-thread-seller">{thread.buyerName}</h2>
            <p className="truncate text-xs text-muted-foreground">
              {thread.subject}{thread.orderStatus ? ` · ${orderStatusLabel(thread.orderStatus)}` : ""}
            </p>
          </div>
        </div>
        <Button size="sm" onClick={() => setCardOpen(true)} className="hidden gap-1.5 sm:inline-flex" data-testid="button-open-send-card">
          <Plus className="h-4 w-4" /> Order card
        </Button>
        <ThreadCall threadId={threadId} />
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 md:p-6" data-testid="thread-messages">
        {messages?.length === 0 && (
          <div className="mx-auto max-w-sm py-16 text-center" data-testid="status-empty-thread">
            <MessageSquare className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-medium">Start the conversation</p>
            <p className="mt-1 text-sm text-muted-foreground">Introduce your factory, ask for the tech pack, or send a priced sample card when you're ready.</p>
          </div>
        )}
        {grouped.map((group) => (
          <section key={group.day} className="space-y-4">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" /><span className="font-mono">{group.day}</span><span className="h-px flex-1 bg-border" />
            </div>
            {group.items.map((msg) => {
              if (msg.messageType === "system" || msg.senderRole === "system") {
                return (
                  <div key={msg.id} className="flex justify-center" data-testid={`system-message-${msg.id}`}>
                    <p className="flex max-w-lg items-start gap-2 rounded-full border border-border bg-secondary/40 px-4 py-1.5 text-center text-xs text-muted-foreground">
                      <Info className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>{msg.content}</span>
                      <span className="shrink-0 font-mono opacity-70">{new Date(msg.sentAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                    </p>
                  </div>
                );
              }
              const isMe = msg.senderRole === "manufacturer";
              const time = new Date(msg.sentAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
              const isCard = msg.messageType === "sample_card" || msg.messageType === "bulk_card";
              if (isCard) {
                return (
                  <div key={msg.id} className={cn("flex flex-col gap-1", isMe ? "items-end" : "items-start")}>
                    {msg.order ? <OrderCard order={msg.order} threadId={threadId} /> : (
                      <div className="rounded-lg border border-border bg-secondary/40 px-4 py-3 text-sm text-muted-foreground">
                        {msg.content || "Order card"} · no longer available
                      </div>
                    )}
                    <span className="px-1 text-[10px] text-muted-foreground">{isMe ? "You" : thread.buyerName} · {time}</span>
                  </div>
                );
              }
              // Signed URLs carry no extension: image messages hold only photos,
              // anything else attached (PDFs, mixed sets) is shown as a file link.
              const images = msg.messageType === "image" ? msg.mediaUrls ?? [] : [];
              const files = msg.messageType === "image" ? [] : msg.mediaUrls ?? [];
              const autoCaption = /^Sent (a photo|\d+ photos|an attachment)$/.test(msg.content);
              return (
                <div key={msg.id} className={cn("flex flex-col gap-1", isMe ? "items-end" : "items-start")} data-testid={`message-${msg.id}`}>
                  <div className={cn(
                    "max-w-[85%] overflow-hidden rounded-2xl text-sm md:max-w-[70%]",
                    isMe ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm border border-border bg-secondary text-foreground",
                  )}>
                    {images.length > 0 && (
                      <div className={cn("grid gap-0.5", images.length > 1 && "grid-cols-2")}>
                        {images.map((url) => (
                          <a key={url} href={url} target="_blank" rel="noreferrer" className="block">
                            <img src={url} alt="Shared in conversation" className={cn("w-full object-cover", images.length > 1 ? "aspect-square" : "max-h-80")} loading="lazy" />
                          </a>
                        ))}
                      </div>
                    )}
                    {files.map((url) => (
                      <a key={url} href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-4 pt-3 underline">
                        <FileText className="h-4 w-4" /> Open attachment
                      </a>
                    ))}
                    {msg.content && !(autoCaption && (images.length || files.length)) && (
                      <p className="whitespace-pre-wrap px-4 py-2.5">{msg.content}</p>
                    )}
                  </div>
                  <span className="px-1 text-[10px] text-muted-foreground">{time}</span>
                </div>
              );
            })}
          </section>
        ))}
        <div ref={endOfMessagesRef} className="h-1" />
      </div>

      <div className="shrink-0 border-t border-border bg-card p-3 md:p-4">
        {attachments.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2" data-testid="attachment-previews">
            {attachments.map((item, index) => (
              <div key={`${item.file.name}-${index}`} className="relative h-16 w-16 overflow-hidden rounded-md border border-border bg-secondary">
                {item.preview ? <img src={item.preview} alt={item.file.name} className="h-full w-full object-cover" /> : (
                  <div className="flex h-full w-full flex-col items-center justify-center p-1 text-[9px] text-muted-foreground"><FileText className="mb-1 h-4 w-4" /><span className="w-full truncate text-center">{item.file.name}</span></div>
                )}
                <button type="button" onClick={() => removeAttachment(index)} className="absolute right-0.5 top-0.5 rounded-full bg-background/90 p-0.5" aria-label={`Remove ${item.file.name}`}>
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <Button type="button" variant="outline" size="icon" onClick={() => setCardOpen(true)} className="shrink-0 sm:hidden" aria-label="Send order card">
            <Plus className="h-4 w-4" />
          </Button>
          <label className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border hover:bg-secondary" data-testid="button-attach-message" title="Attach photos or a PDF">
            <ImagePlus className="h-4 w-4" />
            <span className="sr-only">Attach photos or a PDF</span>
            <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" onChange={(event) => { addFiles(event.target.files); event.currentTarget.value = ""; }} />
          </label>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
            placeholder={`Message ${thread.buyerName}…`}
            title="Enter to send · Shift+Enter for a new line"
            className="max-h-[150px] min-h-[44px] resize-none border-border bg-secondary/30"
            data-testid="input-message-draft"
          />
          <Button onClick={() => void handleSend()} disabled={(!draft.trim() && attachments.length === 0) || sending} className="h-10 shrink-0 px-4" data-testid="button-send-message" aria-label="Send message">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        {attachError && <p className="mt-2 text-sm text-destructive" role="alert">{attachError}</p>}
        {sendError && <p className="mt-2 text-sm text-destructive" role="alert" data-testid="status-send-error">{sendError}</p>}
      </div>

      <SendCardDialog open={cardOpen} onOpenChange={setCardOpen} threadId={threadId} sellerName={thread.buyerName} />
    </div>
  );
}
