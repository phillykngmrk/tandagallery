import { InfiniteFeed } from '@/components/feed/infinite-feed';

export default function HomePage() {
  return (
    <div className="min-h-screen">
      {/* Hero section */}
      <section className="container-wide py-16 md:py-24">
        <div className="max-w-3xl">
          <h1 className="text-display mb-6 fade-in">
            T & A Gallery
          </h1>
          <p className="text-body text-[var(--muted)] max-w-xl fade-in fade-in-delay-1">
            A carefully curated collection of the finest GIFs
            and short videos from across the web. Updated continuously.
          </p>
        </div>
      </section>

      {/* Divider */}
      <div className="divider" />

      {/* Feed section */}
      <section className="py-1">
        <InfiniteFeed type="recent" />
      </section>
    </div>
  );
}
