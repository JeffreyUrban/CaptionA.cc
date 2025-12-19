import { SimpleLayout } from '~/components/SimpleLayout'

export default function ProjectsIndex() {
    return (
        <SimpleLayout
            title="Projects"
            intro="A collection of things I've built. Add your own projects here."
        >
            <div className="mt-16 sm:mt-20">
                <p className="text-base text-zinc-600 dark:text-zinc-400">
                    Projects coming soon...
                </p>
            </div>
        </SimpleLayout>
    )
}
