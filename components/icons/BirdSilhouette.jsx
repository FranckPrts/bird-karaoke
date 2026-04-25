import Image from "next/image";

const HEADER_FLYING_PATH =
  "M14 52c13-11 28-16 43-14 14 2 25 10 29 21l-9 3c-2-6-8-10-17-12-11-2-22 1-33 8l8 7-7 7-18-16 4-4Z";

export default function BirdSilhouette({ src, className }) {
  if (typeof src === "string" && src.startsWith("/")) {
    return (
      <Image
        src={src}
        alt=""
        aria-hidden="true"
        className={className}
        width={100}
        height={100}
        unoptimized
      />
    );
  }

  if (src === "flying") {
    return (
      <svg
        viewBox="0 0 100 100"
        aria-hidden="true"
        className={className}
        fill="currentColor"
      >
        <path d={HEADER_FLYING_PATH} />
      </svg>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={className}
      style={{ display: "inline-block" }}
    />
  );
}
