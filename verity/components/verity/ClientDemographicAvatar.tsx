import Image from "next/image";

interface ClientDemographicAvatarProps {
  age: number | null;
  size?: "compact" | "large";
  inverse?: boolean;
}

function demographicForAge(age: number | null) {
  if (typeof age !== "number" || !Number.isFinite(age)) {
    return {
      label: "Family office",
      image: null,
    };
  }
  if (age < 40) {
    return {
      label: "Age 18–39",
      image: "/client-demographics/young-adult.jpg",
    };
  }
  if (age < 55) {
    return {
      label: "Age 40–54",
      image: "/client-demographics/middle-age.jpg",
    };
  }
  if (age < 70) {
    return {
      label: "Age 55–69",
      image: "/client-demographics/mature-adult.jpg",
    };
  }
  return {
    label: "Age 70+",
    image: "/client-demographics/senior-adult.jpg",
  };
}

export function ClientDemographicAvatar({
  age,
  size = "compact",
  inverse = false,
}: ClientDemographicAvatarProps) {
  const demographic = demographicForAge(age);
  const large = size === "large";
  const hasNumericAge = typeof age === "number" && Number.isFinite(age);

  return (
    <div className="flex shrink-0 items-center gap-2.5">
      <div
        className={`relative overflow-hidden rounded-full border-2 shadow-md ${
          large ? "h-20 w-20" : "h-12 w-12"
        } ${inverse ? "border-white/35" : "border-white/90"}`}
        title={`${demographic.label} reference avatar${
          hasNumericAge ? `; client age ${age}` : ""
        }`}
      >
        {demographic.image ? (
          <Image
            src={demographic.image}
            alt={`Representative portrait for ${demographic.label}`}
            fill
            sizes={large ? "80px" : "48px"}
            className="object-cover"
          />
        ) : (
          <span
            className={`flex h-full w-full items-center justify-center ${
              inverse ? "bg-white/12 text-white" : "bg-navy/8 text-navy"
            }`}
            aria-label="Family office"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className={large ? "h-9 w-9" : "h-6 w-6"}
              aria-hidden="true"
            >
              <path
                d="M4 21V9l8-5 8 5v12M8 21v-7h8v7M9 10h.01M15 10h.01"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        )}
        {hasNumericAge && (
          <span className="absolute bottom-0 right-0 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-navy px-1 text-[9px] font-bold text-white ring-1 ring-white">
            {age}
          </span>
        )}
      </div>
      <span
        className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] ${
          inverse
            ? "border border-white/18 bg-white/10 text-white/72"
            : "bg-navy/7 text-slate/65"
        }`}
      >
        {demographic.label}
      </span>
    </div>
  );
}

