const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = process.env.MONGO_DB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const run = async () => {
  try {
    await client.connect();

    const database = client.db("allrecipedata");
    const recipeCollection = database.collection("recipes");
    const usersdatabase = client.db("recipe");
    const users = usersdatabase.collection("user");
    const newrecipe = database.collection("newrecipe");

    // Popular recipes (sorted by likes)
    app.get("/api/popular-recipe", async (req, res) => {
      try {
        const recipes = await recipeCollection
          .find({})
          .sort({ likesCount: -1 })
          .limit(4)
          .toArray();
        res.send(recipes);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    // Featured Recipe

    app.get("/api/featured-recipe", async (req, res) => {
      try {
        const recipe = await recipeCollection
          .find({ isFeatured: true })
          .limit(4)
          .toArray();
        res.send(recipe);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    // get all & fillter recipe api
    app.get("/api/all-recipe", async (req, res) => {
      try {
        const { category, page = 1, limit = 6 } = req.query;
        let query = {};

        if (category && category !== "all") {
          query.category = { $regex: `^${category}$`, $options: "i" };
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const totalRecipes = await recipeCollection.countDocuments(query);

        const data = await recipeCollection
          .find(query)
          .skip(skip)
          .limit(parseInt(limit))
          .toArray();

        res.send({
          recipes: data,
          totalPages: Math.ceil(totalRecipes / limit),
        });
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });
    // get details by ID

    app.get("/api/details/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await recipeCollection.findOne(query);
        if (!result) {
          return res.status(404).send({ message: "Recipe not found" });
        }
        res.send(result);
      } catch (error) {
        res.status(500).send({
          message: "Invalid ID or Server Error",
          error: error.message,
        });
      }
    });

    // updata user name and image

    app.patch("/api/users", async (req, res) => {
      try {
        const { email, name, url } = req.body;
        const filter = { email: email };
        const updateDoc = {
          $set: {
            name: name,
            image: url,
          },
        };

        const result = await users.updateOne(filter, updateDoc);
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // post new recipe data

    app.post("/api/recipe", async (req, res) => {
      const recipe = req.body;
      const result = await newrecipe.insertOne(recipe);
      res.send(result);
    });

    // add new recipe data get

    app.get("/api/new-recipe", async (req, res) => {
      try {
        const result = await newrecipe.find().toArray();
        res.status(200).send(result);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    // view recipe data

    app.get("/api/viewdetails/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await newrecipe.findOne(query);
        if (!result) {
          return res.status(404).send({ message: "Recipe not found" });
        }
        res.send(result);
      } catch (error) {
        res.status(500).send({
          message: "Invalid ID or Server Error",
          error: error.message,
        });
      }
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } catch (error) {
    console.log(error);
  }
};

run();

app.get("/", (req, res) => {
  res.send("Hello World");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
