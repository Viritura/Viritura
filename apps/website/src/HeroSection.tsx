import { useEffect, useState, type FocusEvent } from "react";
import type { SiteLinks } from "./siteLinks";

const HERO_SLIDE_INTERVAL_MS = 6500;

interface HeroSlide {
  id: string;
  eyebrow: string;
  title: string;
  desc: string;
  image: string;
  imageClass: string;
  alt: string;
  toolbar: string;
  pill: string;
  cta: string;
  width: number;
  height: number;
}

const heroSlides: HeroSlide[] = [
  {
    id: "review",
    eyebrow: "Revisions you can read",
    title: "Every change stays in musical context.",
    desc: "Compare versions in the score itself, down to the measure and notation element.",
    image: "/diff-viewer-preview.png",
    imageClass: "hero-slide-diff",
    alt: "Visual score diff comparing an original score with a modified score and highlighted notation changes.",
    toolbar: "Visual score diff",
    pill: "Visual diff",
    cta: "Review together",
    width: 602,
    height: 282,
  },
  {
    id: "input",
    eyebrow: "Stay in the passage",
    title: "Reach the next marking without breaking focus.",
    desc: "Radial commands, filtering, and shortcuts keep repeated choices close to the music.",
    image: "/fast-workflow-preview.png",
    imageClass: "hero-slide-input",
    alt: "A radial command wheel over a score, with clef and instrument options close to the selected music.",
    toolbar: "Fast note entry",
    pill: "Fast input",
    cta: "See the writing flow",
    width: 792,
    height: 527,
  },
  {
    id: "parts",
    eyebrow: "One musical source",
    title: "Full score, condensed score, and parts stay connected.",
    desc: "Change the music once, then carry that truth into every working view and export.",
    image: "/condensing-preview.png",
    imageClass: "hero-slide-condensing",
    alt: "A condensed horn staff above expanded Horn 1 and Horn 2 parts in the score editor.",
    toolbar: "Condensing workflow",
    pill: "Condensing",
    cta: "See score and parts",
    width: 982,
    height: 473,
  },
];

export function HeroSection({ links }: { links: SiteLinks }) {
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [isCarouselPaused, setIsCarouselPaused] = useState(false);
  const activeSlide = heroSlides[activeSlideIndex]!;

  useEffect(() => {
    if (isCarouselPaused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return undefined;
    }
    const interval = window.setInterval(() => {
      setActiveSlideIndex((current) => (current + 1) % heroSlides.length);
    }, HERO_SLIDE_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [isCarouselPaused]);

  const selectHeroSlide = (index: number) => {
    setActiveSlideIndex(index);
    setIsCarouselPaused(true);
  };
  const resumeHeroCarousel = () => setIsCarouselPaused(false);
  const handleHeroCarouselBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget)) {
      resumeHeroCarousel();
    }
  };

  return (
    <section className="hero">
      <div className="hero-copy">
        <h1>One score, from first note to final handoff.</h1>
        <p>
          Write, refine, review, and publish in one connected notation workspace. Viritura keeps the music coherent
          while the work around it keeps moving.
        </p>
        <div className="hero-buttons">
          <a href={links.app} className="btn btn-primary">
            Open the web editor
          </a>
        </div>
        <p className="hero-proof">Open score format · Git-backed projects · Built for the browser</p>
      </div>
      <div className="hero-preview" onBlur={handleHeroCarouselBlur} onMouseLeave={resumeHeroCarousel}>
        <div className="preview-toolbar">
          <span className="preview-dot" />
          <span className="preview-title">{activeSlide.toolbar}</span>
          <span className="preview-pill">{activeSlide.pill}</span>
        </div>
        <img
          key={activeSlide.image}
          className={`hero-slide-image ${activeSlide.imageClass}`}
          src={activeSlide.image}
          alt={activeSlide.alt}
          width={activeSlide.width}
          height={activeSlide.height}
          fetchPriority="high"
          decoding="async"
        />
        <div
          key={`${activeSlide.id}-caption`}
          id="hero-slide-panel"
          role="tabpanel"
          aria-labelledby={`hero-tab-${activeSlide.id}`}
          aria-live={isCarouselPaused ? "polite" : "off"}
          className="hero-slide-caption"
        >
          <span className="hero-slide-eyebrow">{activeSlide.eyebrow}</span>
          <h2>{activeSlide.title}</h2>
          <p>{activeSlide.desc}</p>
          <a href={`#${activeSlide.id}`}>{activeSlide.cta}</a>
        </div>
        <div className="hero-carousel-controls" role="tablist" aria-label="Featured workflows">
          {heroSlides.map((slide, index) => (
            <button
              key={slide.id}
              type="button"
              role="tab"
              id={`hero-tab-${slide.id}`}
              aria-controls="hero-slide-panel"
              aria-selected={activeSlide.id === slide.id}
              className={activeSlide.id === slide.id ? "carousel-tab active" : "carousel-tab"}
              onClick={() => selectHeroSlide(index)}
            >
              {slide.pill}
            </button>
          ))}
        </div>
        <div className="hero-carousel-progress" aria-hidden="true">
          <span
            key={`${activeSlide.id}-${isCarouselPaused ? "paused" : "running"}`}
            className={isCarouselPaused ? "hero-carousel-progress-fill paused" : "hero-carousel-progress-fill"}
          />
        </div>
      </div>
    </section>
  );
}
