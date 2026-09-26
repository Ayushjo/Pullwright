# devin-test-app

A tiny bookstore API (Node 20+, no dependencies) used to exercise the Pullwright agent.

```
src/
  server.js      node:http app — GET /health, GET /books, GET /books/:id, POST /cart/quote
  router.js      minimal router with :params
  inventory.js   in-memory inventory (loads src/data/books.json)
  cart.js        cart with discount codes + tax
  report.js      inventory statistics and text/markdown/csv reports
  format.js      currency / slug / date helpers
  math.js        arithmetic helpers
test/            node:test suites
```

Run the tests with `npm test`. Start the API with `npm start`.
