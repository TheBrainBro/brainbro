export function Placeholder({ title, description }: { title: string; description: string }) {
  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-zinc-500">{description}</p>
    </div>
  )
}
