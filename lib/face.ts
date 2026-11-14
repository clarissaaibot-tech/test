"use client";

// Face analysis runs entirely in the browser. Only the resulting 128-number
// descriptor is ever sent to the server; a search reference photo never leaves the device.

type FaceApi = typeof import("@vladmandic/face-api");

let ready: Promise<FaceApi> | null = null;

function load(): Promise<FaceApi> {
  if (!ready) {
    ready = (async () => {
      const faceapi = await import("@vladmandic/face-api");
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri("/models"),
        faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
        faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
      ]);
      return faceapi;
    })();
    ready.catch(() => (ready = null));
  }
  return ready;
}

export class FaceError extends Error {}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new FaceError("We couldn't read that image. Try a JPG or PNG."));
    img.src = src;
  });
}

/** Returns the descriptor for the single face in the image, or throws a FaceError the user can act on. */
export async function describeFace(source: File | string): Promise<number[]> {
  const faceapi = await load();
  const url = typeof source === "string" ? source : URL.createObjectURL(source);
  try {
    const img = await loadImage(url);
    const faces = await faceapi
      .detectAllFaces(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptors();
    if (faces.length === 0) {
      throw new FaceError("No face found. Use a clear, front-facing photo.");
    }
    if (faces.length > 1) {
      throw new FaceError("More than one face found. Use a photo with only one person.");
    }
    return Array.from(faces[0].descriptor);
  } finally {
    if (typeof source !== "string") URL.revokeObjectURL(url);
  }
}
