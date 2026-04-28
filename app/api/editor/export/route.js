import { promises as fs } from "node:fs";
import path from "node:path";
import JSZip from "jszip";

const DATA_PATH = path.join(process.cwd(), "data", "birds.json");
const PUBLIC_DIR = path.join(process.cwd(), "public");

export const runtime = "nodejs";

function sanitizeSegment(value, fallback) {
  if (!value || typeof value !== "string") return fallback;
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function getAudioFullPath(recordingPath) {
  if (!recordingPath || typeof recordingPath !== "string") return null;
  const normalized = path.normalize(recordingPath).replace(/^(\.\.[/\\])+/, "");
  const localRelative = normalized.startsWith("/") ? normalized.slice(1) : normalized;
  const fullPath = path.join(PUBLIC_DIR, localRelative);
  if (!fullPath.startsWith(PUBLIC_DIR)) return null;
  return { fullPath, localRelative };
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { birdId, recordingId, noteMask } = body || {};
    if (!birdId || !recordingId) {
      return Response.json({ error: "Invalid payload." }, { status: 400 });
    }

    const raw = await fs.readFile(DATA_PATH, "utf8");
    const birds = JSON.parse(raw);
    const bird = birds.find((entry) => entry.id === birdId);
    const recording = bird?.recordings?.find((entry) => entry.id === recordingId);
    if (!bird || !recording) {
      return Response.json({ error: "Recording not found." }, { status: 404 });
    }

    const exportMask = typeof noteMask === "string" ? noteMask : recording.noteMask || "";
    const zip = new JSZip();

    zip.file(
      "metadata.json",
      `${JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          bird: {
            id: bird.id,
            name: bird.name,
            silhouette: bird.silhouette || null,
          },
          recording: {
            ...recording,
            noteMask: exportMask,
          },
        },
        null,
        2,
      )}\n`,
    );
    zip.file("mask.txt", exportMask);

    const audioPathInfo = getAudioFullPath(recording.path);
    if (audioPathInfo) {
      try {
        const audioBuffer = await fs.readFile(audioPathInfo.fullPath);
        zip.file(path.posix.join("audio", path.basename(audioPathInfo.localRelative)), audioBuffer);
      } catch {
        zip.file(
          "README-export.txt",
          "Audio file path is declared in metadata but the file was not found in /public. Metadata and mask are still included.",
        );
      }
    } else {
      zip.file(
        "README-export.txt",
        "No local audio path is attached to this recording. Metadata and mask are included, but no audio file could be exported.",
      );
    }

    const archive = await zip.generateAsync({ type: "uint8array" });
    const birdName = sanitizeSegment(bird.name, bird.id || "bird");
    const recordingName = sanitizeSegment(recording.id, "recording");
    const fileName = `bird-karaoke-${birdName}-${recordingName}.zip`;

    return new Response(archive, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch {
    return Response.json({ error: "Failed to export recording package." }, { status: 500 });
  }
}
