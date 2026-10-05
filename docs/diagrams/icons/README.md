# Technology symbols

The four local SVGs come from [Simple Icons v16.0.0](https://github.com/simple-icons/simple-icons/tree/16.0.0/icons): PostgreSQL, Redis, RabbitMQ and Node.js. Simple Icons distributes its icons under [CC0](https://github.com/simple-icons/simple-icons/blob/16.0.0/LICENSE.md). Brand usage remains subject to each owner's trademark guidelines. The console uses neutral process/proxy shapes where no brand asset is supplied.

Assets are stored locally: rendering the console makes no CDN requests. The editable backend scene embeds these same assets. Regenerate it with `pnpm exec tsx tools/backend-diagram.ts` after changing `tools/backend-map.json`. The diagram is a static architecture description; it does not embed health samples or private hostnames.
