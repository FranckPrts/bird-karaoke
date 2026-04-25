import "./globals.css";

export const metadata = {
  title: "Bird Karaoke",
  description: "Mimic bird calls and compare your spectrogram score.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
