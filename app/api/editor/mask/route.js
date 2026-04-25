import { promises as fs } from "node:fs";
import path from "node:path";

const DATA_PATH = path.join(process.cwd(), "data", "birds.json");

export async function POST(request) {
  try {
    const body = await request.json();
    const { birdId, recordingId, noteMask } = body || {};
    if (!birdId || !recordingId || typeof noteMask !== "string") {
      return Response.json({ error: "Invalid payload." }, { status: 400 });
    }

    const raw = await fs.readFile(DATA_PATH, "utf8");
    const birds = JSON.parse(raw);
    let updated = false;

    const nextBirds = birds.map((bird) => {
      if (bird.id !== birdId) return bird;
      return {
        ...bird,
        recordings: (bird.recordings || []).map((recording) => {
          if (recording.id !== recordingId) return recording;
          updated = true;
          return {
            ...recording,
            noteMask,
          };
        }),
      };
    });

    if (!updated) {
      return Response.json({ error: "Recording not found." }, { status: 404 });
    }

    await fs.writeFile(DATA_PATH, `${JSON.stringify(nextBirds, null, 2)}\n`, "utf8");
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Failed to save note mask." }, { status: 500 });
  }
}
