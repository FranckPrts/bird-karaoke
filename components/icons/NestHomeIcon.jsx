/** Decorative nest shape for the home control (twig cup + hint of eggs). */
export default function NestHomeIcon({ className }) {
  return (
    <svg
  className={className}
  viewBox="0 0 40 40"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
  aria-hidden="true"
>
  {/* Woven ring (main identity) */}
  <path
    d="M20 31
       C11 31 6.5 25.5 6.5 22
       C6.5 18.5 10 15.5 13.5 15.5
       C15 12.5 18 11 20 11
       C22 11 25 12.5 26.5 15.5
       C30 15.5 33.5 18.5 33.5 22
       C33.5 25.5 29 31 20 31Z"
    stroke="currentColor"
    strokeWidth="1.4"
    fill="currentColor"
    fillOpacity="0.06"
  />

  {/* Interwoven branch loops (the key difference) */}
  <path
    d="M9 22
       C12 19 16 20 20 22
       C24 24 28 25 31 22"
    stroke="currentColor"
    strokeWidth="1.2"
    strokeLinecap="round"
  />
  <path
    d="M10.5 24
       C14 22 17 23 20 24.5
       C23 26 26 26.5 29.5 24"
    stroke="currentColor"
    strokeWidth="1.05"
    strokeLinecap="round"
    opacity="0.75"
  />

  {/* Single twig crossing edge (intentional asymmetry) */}
  <path
    d="M12 16.5L8.5 15M28 16.5L31.5 15"
    stroke="currentColor"
    strokeWidth="1"
    strokeLinecap="round"
    opacity="0.6"
  />

  {/* Eggs (more centered + iconic) */}
  <ellipse cx="18" cy="23" rx="1.9" ry="1.4" fill="currentColor" fillOpacity="0.35" />
  <ellipse cx="22.5" cy="23.3" rx="1.7" ry="1.3" fill="currentColor" fillOpacity="0.28" />
</svg>
  );
}
