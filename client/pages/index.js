import { useEffect } from "react";
import { useRouter } from "next/router";

export default function HomePage({ keycloak }) {
    const router = useRouter();

    useEffect(() => {
        if (keycloak?.authenticated) {
            router.replace('/media');
        }
    }, [keycloak?.authenticated, router]);

    if (keycloak?.authenticated) {
        return null;
    }

    return (
        <div className="min-h-screen w-full bg-black text-white">
            {/* Hero */}
            <section className="px-6 md:px-10 lg:px-16 min-h-[88vh] flex items-center justify-center">
                <div className="w-full max-w-6xl mx-auto">
                    <div className="relative rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] p-8 md:p-12 lg:p-16">
                        {/* Glow accent */}
                        <div className="pointer-events-none absolute -inset-0.5 rounded-3xl bg-[radial-gradient(circle_at_50%_-20%,rgba(0,255,255,0.16),transparent_40%),radial-gradient(circle_at_80%_120%,rgba(168,85,247,0.16),transparent_40%)]"></div>
                        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
                            <div>
                                <h1 className="font-brand text-5xl md:text-6xl font-extrabold tracking-tight mb-5">
                                    Eventify
                                </h1>
                                <p className="text-sm md:text-base text-white/70 leading-relaxed max-w-xl mb-10">
                                    An ultra-modern platform for event booking and notifications. Plan, publish, and participate with realtime updates across organizations.
                                </p>
                                <div className="flex items-center gap-4">
                                    <button
                                        onClick={() => keycloak?.login?.()}
                                        className="px-8 py-3 rounded-2xl bg-white text-black font-semibold tracking-wide hover:bg-white/90 transition shadow-[0_10px_30px_rgba(0,255,255,0.15)] ring-1 ring-white/20"
                                    >
                                        Get Started
                                    </button>
                                    <button
                                        onClick={() => keycloak?.login?.({ idpHint: 'google' })}
                                        className="px-4 py-2 rounded-xl text-white/80 hover:text-white border border-white/15 hover:border-white/25 transition"
                                    >
                                        Continue with Google
                                    </button>
                                </div>
                            </div>
                            <div>
                                <img src="/event.png" alt="Event showcase" className="w-full h-auto" />
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Features */}
            <section id="features" className="px-6 md:px-10 lg:px-16 py-12 md:py-20">
                <div className="w-full max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
                    {[{
                        title: 'Real-time Notifications',
                        desc: 'Stay in sync with instant updates on bookings and changes.'
                    },{
                        title: 'Multi-Org Ready',
                        desc: 'Switch contexts and manage events across organizations.'
                    },{
                        title: 'Scalable & Secure',
                        desc: 'Backed by modern auth and robust infrastructure.'
                    }].map((f, i) => (
                        <div key={i} className="rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:bg-white/10 transition">
                            <div className="mb-3 h-1.5 w-12 rounded-full" style={{ backgroundColor: i === 0 ? 'rgba(0,255,255,0.6)' : i === 1 ? 'rgba(168,85,247,0.6)' : 'rgba(255,255,255,0.25)' }}></div>
                            <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
                            <p className="text-sm text-white/70 leading-relaxed">{f.desc}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* How it works - steps */}
            <section id="how-it-works" className="px-6 md:px-10 lg:px-16 py-12 md:py-20">
                <div className="w-full max-w-6xl mx-auto">
                    <h2 className="text-2xl md:text-3xl font-bold mb-6">How it works</h2>
                    <ol className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {["Sign in with Keycloak","Browse & book events","Get realtime notifications"].map((s, idx) => (
                            <li key={idx} className="rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 p-6">
                                <div className="text-sm text-white/60 mb-2">Step {idx+1}</div>
                                <div className="text-lg font-semibold">{s}</div>
                            </li>
                        ))}
                    </ol>
                </div>
            </section>

            {/* Team / About */}
            <section id="team" className="px-6 md:px-10 lg:px-16 py-12 md:py-20">
                <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center">
                    <div className="order-2 lg:order-1">
                        <div className="rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                            <h2 className="text-2xl md:text-3xl font-bold mb-4">Built for modern teams</h2>
                            <p className="text-sm md:text-base text-white/70 leading-relaxed">
                                Eventify helps teams coordinate events with clarity and speed. From organizers to attendees, everyone stays aligned through a streamlined, minimal interface.
                            </p>
                        </div>
                    </div>
                    <div className="order-1 lg:order-2">
                        <img src="/team.png" alt="Team" className="w-full h-auto" />
                    </div>
                </div>
            </section>

            {/* Tech mapping - alternating cards */}
            <section id="tech" className="px-6 md:px-10 lg:px-16 py-12 md:py-20">
                <div className="w-full max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
                    {[{
                        title: 'Keycloak',
                        desc: 'Role-based auth + social logins. Organizers manage events.'
                    },{
                        title: 'Next.js',
                        desc: 'SSR frontend for discovery and booking with organizer tools.'
                    },{
                        title: 'Postgres + Redis',
                        desc: 'Durable data + real-time seat availability and caching.'
                    },{
                        title: 'RabbitMQ',
                        desc: 'Async notifications and background booking workflows.'
                    }].map((t, i) => (
                        <div key={i} className={`rounded-2xl border p-6 backdrop-blur-xl ${i % 2 === 0 ? 'bg-white/5 border-white/10' : 'bg-white/10 border-white/20'} hover:bg-white/10 transition`}>
                            <h3 className="text-lg font-semibold mb-2">{t.title}</h3>
                            <p className="text-sm text-white/70 leading-relaxed">{t.desc}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* Bonus - pill list */}
            <section id="bonus" className="px-6 md:px-10 lg:px-16 py-12 md:py-20">
                <div className="w-full max-w-6xl mx-auto">
                    <h2 className="text-2xl md:text-3xl font-bold mb-6">Bonus</h2>
                    <div className="flex flex-wrap gap-3">
                        {["Waitlist & auto-assign","Live updates via Pub/Sub","Payment simulation"].map((b,i)=>(
                            <span key={i} className="px-4 py-2 rounded-full bg-white/5 border border-white/10 text-sm text-white/80">{b}</span>
                        ))}
                    </div>
                </div>
            </section>

            {/* Footer - card layout with image on right */}
            <footer className="px-6 md:px-10 lg:px-16 py-12 md:py-16">
                <div className="w-full max-w-6xl mx-auto">
                    <div className="rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                            <div>
                                <div className="font-brand text-2xl font-semibold tracking-tight">Eventify</div>
                                <div className="text-sm text-white/70 mt-1">Book smarter. Notify faster.</div>
                                <div className="mt-4 flex items-center gap-3">
                                    <button
                                        onClick={() => keycloak?.login?.()}
                                        className="px-5 py-2 rounded-xl bg-white text-black text-sm font-semibold tracking-wide hover:bg-white/90 transition shadow-[0_6px_20px_rgba(255,255,255,0.15)] ring-1 ring-white/20"
                                    >
                                        Get Started
                                    </button>
                                    <a href="#features" className="text-sm text-white/80 hover:text-white transition">Features</a>
                                    <a href="#team" className="text-sm text-white/80 hover:text-white transition">Team</a>
                                </div>
                                <div className="mt-4 text-xs text-white/60">© {new Date().getFullYear()} Eventify. All rights reserved.</div>
                            </div>
                            <div>
                                <div className="relative rounded-2xl bg-white/5 backdrop-blur-lg border border-white/10 p-3 shadow-inner">
                                    <img src="/footer.png" alt="Footer" className="w-full h-auto rounded-xl object-cover" />
                                    <div className="absolute inset-0 rounded-2xl pointer-events-none shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </footer>
        </div>
    );
}

