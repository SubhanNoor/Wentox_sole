import AppLayout from '@/components/AppLayout';

export default function HomePage() {
  return (
    <AppLayout pageTitle="Home">
      <div className="flex flex-col items-center justify-center gap-6" style={{ minHeight: '60vh' }}>
        <div
          className="flex items-center justify-center flex-shrink-0"
          style={{
            width: 96, height: 96, borderRadius: 20,
            background: 'var(--brand-gold)'
          }}
        >
          <span className="font-lora font-bold text-5xl" style={{ color: 'var(--brand-navy)' }}>W</span>
        </div>
        <div className="text-center">
          <h1
            className="font-lora font-bold tracking-wide"
            style={{ fontSize: '28px', color: 'var(--dark-heading)' }}
          >
            WENTOX WAREHOUSE
          </h1>
          <p
            className="font-inter tracking-widest uppercase font-semibold mt-1"
            style={{ color: 'var(--brand-gold)', letterSpacing: '2px', fontSize: '12px' }}
          >
            Footwear Distribution
          </p>
        </div>
      </div>
    </AppLayout>
  );
}
