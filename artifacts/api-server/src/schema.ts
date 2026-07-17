import { z } from "zod";

export const streamConfigSchema = z.object({
  id: z.string(),
  sourceType: z.enum(["tiktok", "youtube", "facebook", "camera", "xspace", "upload", "link"]).default("tiktok"),
  tiktokUsername: z.string().default(""),
  youtubeSourceUrl: z.string().default(""),
  facebookSourceUrl: z.string().default(""),
  linkSourceUrl: z.string().default(""),
  cameraDevice: z.string().default("/dev/video0"),
  xspaceUrl: z.string().default(""),
  xspaceImageUrl: z.string().default(""),
  xspaceVideoPath: z.string().default(""),
  uploadedVideoPath: z.string().default(""),
  uploadedVideoLoop: z.boolean().default(true),
  youtubeStreamKey: z.string().default(""),
  facebookRtmpUrl: z.string().default(""),
  instagramStreamKey: z.string().default(""),
  tiktokStreamKey: z.string().default(""),
  youtubeChannelId: z.string().default(""),
  ratio: z.enum(["mobile", "desktop"]).default("mobile"),
  quality: z.enum(["best", "720p", "480p"]).default("best"),
  aqmMode: z.enum(["auto", "force_4k", "force_1440p", "force_1080p", "force_720p", "force_540p", "force_480p", "force_360p", "force_240p"]).default("auto"),
  fps: z.enum(["20", "24", "25", "30", "60"]).default("30"),
  encoderPreset: z.enum(["ultrafast", "veryfast", "faster", "fast"]).default("veryfast"),
  muted: z.boolean().default(false),
  autoRestart: z.boolean().default(false),
  status: z.enum(["idle", "streaming", "error", "reconnecting"]).default("idle"),
  micDevice: z.string().default(""),
  micEnabled: z.boolean().default(false),
  autoReconnect: z.boolean().default(true),
  maxReconnectMinutes: z.number().int().min(1).max(120).nullable().default(null),
});

export const insertStreamSchema = streamConfigSchema.omit({ id: true, status: true });

export type StreamConfig = z.infer<typeof streamConfigSchema>;
export type InsertStream = z.infer<typeof insertStreamSchema>;

export const loginSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof loginSchema>;
