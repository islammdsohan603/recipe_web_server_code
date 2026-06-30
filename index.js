const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({
  origin: [process.env.NEXT_PUBLIC_CLIENT_URL, "http://localhost:3000"],
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

const uri = process.env.MONGO_DB_URI;
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.PASS,
  },
});

const run = async () => {
  try {
    // await client.connect();

    const database = client.db("allrecipedata");
    const recipeCollection = database.collection("recipes");
    const usersdatabase = client.db("recipe");
    const users = usersdatabase.collection("user");
    const newrecipe = database.collection("newrecipe");
    const reportsCollection = database.collection("reports");
    const paymentsCollection = database.collection("payments");
    const favoritesCollection = database.collection("favorites");

    // =============================================
    // JWT AUTH & MIDDLEWARE
    // =============================================
    const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_key_for_dev";

    // Generate token endpoint
    app.post("/api/auth/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, JWT_SECRET, { expiresIn: "1d" });
      
      res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
      })
      .send({ success: true });
    });

    // Clear token on logout
    app.post("/api/auth/logout", async (req, res) => {
      res.clearCookie("token", {
        maxAge: 0,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
      })
      .send({ success: true });
    });

    // Verify Token Middleware
    const verifyToken = (req, res, next) => {
      const token = req.cookies?.token;
      if (!token) {
        return res.status(401).send({ message: "Unauthorized access" });
      }
      jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "Unauthorized access" });
        }
        req.user = decoded;
        next();
      });
    };
    // =============================================

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
          // Splitting categories by comma if multiple are sent, then using $in
          const categoryArray = category.split(',').map(c => new RegExp(`^${c.trim()}$`, "i"));
          query.category = { $in: categoryArray };
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

    app.get(
      "/api/details/:id",

      async (req, res) => {
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
      },
    );

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
      try {
        const recipeData = req.body;

        const finalRecipe = {
          ...recipeData,
          email:
            recipeData.email || recipeData.userEmail || recipeData.authorEmail,
        };

        if (!finalRecipe.email) {
          return res.status(400).json({
            success: false,
            message: "User email is required to add a recipe",
          });
        }

        const result = await newrecipe.insertOne(finalRecipe);
        res.status(201).send(result);
      } catch (error) {
        res.status(500).send({ message: "Server error", error: error.message });
      }
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

    app.get("/api/view-details/:id", async (req, res) => {
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

    // view recipe update data

    app.patch("/api/update-recipe", async (req, res) => {
      try {
        const { id, ...updateData } = req.body;

        if (!id) {
          return res
            .status(400)
            .json({ success: false, message: "Recipe ID is required" });
        }

        const filter = { _id: new ObjectId(id) };

        const updateDoc = {
          $set: updateData,
        };

        const result = await newrecipe.updateOne(filter, updateDoc);

        if (result.matchedCount === 0) {
          return res
            .status(404)
            .json({ success: false, message: "Recipe not found" });
        }

        res.status(200).json({
          success: true,
          message: "Recipe updated successfully",
          result,
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: "Internal server error",
          error: error.message,
        });
      }
    });

    // view recipe delete api create
    app.delete("/api/delete-view-recipe", async (req, res) => {
      try {
        const id = req.query.id;

        if (!id) {
          return res
            .status(400)
            .json({ success: false, message: "Recipe ID is required" });
        }

        const query = { _id: new ObjectId(id) };

        const result = await newrecipe.deleteOne(query);

        if (result.deletedCount === 0) {
          return res
            .status(404)
            .json({ success: false, message: "Recipe not found" });
        }

        res.status(200).json({
          success: true,
          message: "Recipe deleted successfully",
          result,
        });
      } catch (error) {
        console.error("Delete Error:", error);
        res.status(500).json({
          success: false,
          message: "Internal server error",
          error: error.message,
        });
      }
    });

    // Unique Like Count API
    app.patch("/api/recipe/like/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const { email } = req.body;

        if (!email) {
          return res
            .status(400)
            .json({ success: false, message: "User email is required" });
        }
        if (!ObjectId.isValid(id)) {
          return res
            .status(400)
            .json({ success: false, message: "Invalid Recipe ID" });
        }

        const query = { _id: new ObjectId(id) };

        let recipe = await recipeCollection.findOne(query);

        if (!recipe) {
          recipe = await newrecipe.findOne(query);
        }

        if (!recipe) {
          return res
            .status(404)
            .json({ success: false, message: "Recipe not found" });
        }

        if (recipe.likedBy && recipe.likedBy.includes(email)) {
          return res.status(400).json({
            success: false,
            isAlreadyLiked: true,
            message: "You have already liked this recipe!",
          });
        }

        const updateDoc = {
          $inc: { likesCount: 1 },
          $addToSet: { likedBy: email },
        };

        let result = await recipeCollection.updateOne(query, updateDoc);

        if (result.matchedCount === 0) {
          result = await newrecipe.updateOne(query, updateDoc);
        }

        res.status(200).json({ success: true, message: "Liked successfully!" });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: "Server error",
          error: error.message,
        });
      }
    });

    // my recipe api create

    app.get("/api/my-recipe", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const result = await newrecipe.find(query).toArray();
      res.send(result);
    });

    // user like count  API

    app.get("/api/user-liked-count", async (req, res) => {
      try {
        const { email } = req.query;
        if (!email) return res.status(400).json({ error: "Email is required" });

        const mainCollectionCount = await recipeCollection.countDocuments({
          likedBy: email,
        });

        const newCollectionCount = await newrecipe.countDocuments({
          likedBy: email,
        });

        const totalCount = mainCollectionCount + newCollectionCount;

        res.status(200).json({ count: totalCount });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // favorites api

    app.get("/api/my-favorites", async (req, res) => {
      try {
        const { email } = req.query;
        if (!email) return res.status(400).json({ error: "Email is required" });

        const favorites = await favoritesCollection
          .find({ userEmail: email })
          .toArray();
        res.status(200).json(favorites);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // single favorites api
    app.patch("/api/recipe/favorite/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { email, recipeData } = req.body;

        if (!email)
          return res
            .status(400)
            .json({ success: false, message: "Email required" });

        const query = { recipeId: id, userEmail: email };
        const existing = await favoritesCollection.findOne(query);

        if (existing) {
          await favoritesCollection.deleteOne(query);
          return res.status(200).json({
            success: true,
            isFavorited: false,
            message: "Removed from favorites",
          });
        } else {
          await favoritesCollection.insertOne({
            ...recipeData,
            recipeId: id,
            userEmail: email,
            createdAt: new Date(),
          });
          return res.status(200).json({
            success: true,
            isFavorited: true,
            message: "Added to favorites",
          });
        }
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Reports api

    app.post("/api/recipe/report", async (req, res) => {
      try {
        const { recipeId, recipeName, userEmail, reason, details } = req.body;

        if (!recipeId || !reason) {
          return res.status(400).json({
            success: false,
            message: "Recipe ID and Reason are required",
          });
        }

        const reportDoc = {
          recipeId: new ObjectId(recipeId),
          recipeName,
          userEmail: userEmail || "Anonymous",
          reason,
          details: details || "",
          createdAt: new Date(),
        };

        const result = await reportsCollection.insertOne(reportDoc);
        res.status(201).json({
          success: true,
          message: "Report submitted successfully!",
          result,
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: "Server error",
          error: error.message,
        });
      }
    });

    // paymants systam

    app.post("/api/create-checkout-session", async (req, res) => {
      try {
        const { recipeId, recipeName, recipeImage, price, userEmail } =
          req.body;

        if (!recipeId || !price || !userEmail) {
          return res
            .status(400)
            .json({ success: false, message: "Missing required fields" });
        }

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: recipeName || "Premium Recipe",
                  images: recipeImage ? [recipeImage] : [],
                  metadata: {
                    recipeId: recipeId.toString(),
                  },
                },
                unit_amount: Math.round(price * 100),
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          customer_email: userEmail,
          success_url: `${process.env.NEXT_PUBLIC_CLIENT_URL}/dashboard/user/paymant/success?session_id={CHECKOUT_SESSION_ID}&recipeId=${recipeId}`,
          cancel_url: `${process.env.NEXT_PUBLIC_CLIENT_URL}/details/${recipeId}`,
        });

        res.status(200).json({ id: session.id, url: session.url });
      } catch (error) {
        console.error("🔴 STRIPE BACKEND ERROR:", error.message);
        res.status(500).json({
          success: false,
          message: "Internal Server Error",
          error: error.message,
        });
      }
    });

    // my paymants
    app.post("/api/save-payment", async (req, res) => {
      try {
        const { sessionId, recipeId, recipeName, userEmail, price } = req.body;

        if (!sessionId || !recipeId || !userEmail) {
          return res
            .status(400)
            .json({ success: false, message: "Missing required fields" });
        }

        const alreadySaved = await paymentsCollection.findOne({
          sessionId: sessionId,
        });
        if (alreadySaved) {
          return res
            .status(200)
            .json({ success: true, message: "Payment already saved" });
        }

        const paymentDoc = {
          sessionId,
          recipeId,
          recipeName: recipeName || "Premium Recipe",
          userEmail,
          price: parseFloat(price),
          createdAt: new Date(),
        };

        const result = await paymentsCollection.insertOne(paymentDoc);
        res.status(201).json({
          success: true,
          message: "Payment saved successfully!",
          result,
        });
      } catch (error) {
        console.error("Error saving payment:", error);
        res
          .status(500)
          .json({ success: false, message: "Internal server error" });
      }
    });

    // my paymant get
    app.get("/api/my-purchased-recipes", async (req, res) => {
      try {
        const email = req.query.email;

        if (!email) {
          return res
            .status(400)
            .json({ success: false, message: "Email is required" });
        }

        const result = await paymentsCollection
          .find({ userEmail: email })
          .toArray();

        res.status(200).send(result);
      } catch (error) {
        console.error("Error fetching purchased recipes:", error);
        res.status(500).json({
          success: false,
          message: "Server error",
          error: error.message,
        });
      }
    });

    // =============================================
    // ADMIN ROUTES
    // =============================================

    // Admin Stats Overview
    app.get("/api/admin/stats", verifyToken, async (req, res) => {
      try {
        const usersDb = client.db("recipe");
        const usersCollection = usersDb.collection("user");

        const totalUsers = await usersCollection.countDocuments();
        const totalRecipesMain = await recipeCollection.countDocuments();
        const totalRecipesNew = await newrecipe.countDocuments();
        const totalRecipes = totalRecipesMain + totalRecipesNew;
        const totalPremiumMembers = await paymentsCollection.aggregate([
          { $group: { _id: "$userEmail" } },
          { $count: "count" }
        ]).toArray();
        const totalReports = await reportsCollection.countDocuments();

        res.status(200).json({
          totalUsers,
          totalRecipes,
          totalPremiumMembers: totalPremiumMembers[0]?.count || 0,
          totalReports,
        });
      } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
      }
    });

    // Admin Get All Users
    app.get("/api/admin/users", verifyToken, async (req, res) => {
      try {
        const usersDb = client.db("recipe");
        const usersCollection = usersDb.collection("user");
        const allUsers = await usersCollection.find({}).toArray();
        res.status(200).json(allUsers);
      } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
      }
    });

    // Admin Block / Unblock User
    app.patch("/api/admin/users/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const { isBlocked } = req.body;
        const usersDb = client.db("recipe");
        const usersCollection = usersDb.collection("user");

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { isBlocked: !!isBlocked } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ success: false, message: "User not found" });
        }

        res.status(200).json({
          success: true,
          message: isBlocked ? "User blocked successfully" : "User unblocked successfully",
        });
      } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
      }
    });

    // Admin Get All Recipes (both collections)
    app.get("/api/admin/recipes", verifyToken, async (req, res) => {
      try {
        const mainRecipes = await recipeCollection.find({}).toArray();
        const newRecipes = await newrecipe.find({}).toArray();

        const allRecipes = [
          ...mainRecipes.map(r => ({ ...r, source: "main" })),
          ...newRecipes.map(r => ({ ...r, source: "new" })),
        ];

        res.status(200).json(allRecipes);
      } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
      }
    });

    // Admin Delete Recipe
    app.delete("/api/admin/recipes/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const { source } = req.query;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ success: false, message: "Invalid ID" });
        }

        const query = { _id: new ObjectId(id) };
        let result;

        if (source === "main") {
          result = await recipeCollection.deleteOne(query);
        } else if (source === "new") {
          result = await newrecipe.deleteOne(query);
        } else {
          // Try both
          result = await recipeCollection.deleteOne(query);
          if (result.deletedCount === 0) {
            result = await newrecipe.deleteOne(query);
          }
        }

        if (result.deletedCount === 0) {
          return res.status(404).json({ success: false, message: "Recipe not found" });
        }

        res.status(200).json({ success: true, message: "Recipe deleted successfully" });
      } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
      }
    });

    // Admin Edit Recipe
    app.patch("/api/admin/recipes/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const { source, ...updateData } = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ success: false, message: "Invalid ID" });
        }

        delete updateData._id;
        const query = { _id: new ObjectId(id) };
        const updateDoc = { $set: updateData };
        let result;

        if (source === "main") {
          result = await recipeCollection.updateOne(query, updateDoc);
        } else if (source === "new") {
          result = await newrecipe.updateOne(query, updateDoc);
        } else {
          result = await recipeCollection.updateOne(query, updateDoc);
          if (result.matchedCount === 0) {
            result = await newrecipe.updateOne(query, updateDoc);
          }
        }

        if (result.matchedCount === 0) {
          return res.status(404).json({ success: false, message: "Recipe not found" });
        }

        res.status(200).json({ success: true, message: "Recipe updated successfully" });
      } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
      }
    });

    // Admin Feature / Unfeature Recipe
    app.patch("/api/admin/recipes/:id/feature", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const { isFeatured, source } = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ success: false, message: "Invalid ID" });
        }

        const query = { _id: new ObjectId(id) };
        const updateDoc = { $set: { isFeatured: !!isFeatured } };
        let result;

        if (source === "main") {
          result = await recipeCollection.updateOne(query, updateDoc);
        } else if (source === "new") {
          result = await newrecipe.updateOne(query, updateDoc);
        } else {
          result = await recipeCollection.updateOne(query, updateDoc);
          if (result.matchedCount === 0) {
            result = await newrecipe.updateOne(query, updateDoc);
          }
        }

        if (result.matchedCount === 0) {
          return res.status(404).json({ success: false, message: "Recipe not found" });
        }

        res.status(200).json({
          success: true,
          message: isFeatured ? "Recipe featured successfully" : "Recipe unfeatured successfully",
        });
      } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
      }
    });

    // Admin Get All Reports
    app.get("/api/admin/reports", verifyToken, async (req, res) => {
      try {
        const reports = await reportsCollection.find({}).sort({ createdAt: -1 }).toArray();
        res.status(200).json(reports);
      } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
      }
    });

    // =============================================
    // END OF ADMIN ROUTES
    // =============================================

    // gmail api

    // gmail api - ওটিপি পাঠানোর জন্য আপডেট করা হলো
    app.post("/api/send-email", async (req, res) => {
      try {
        const { name, email } = req.body; // query-র বদলে বডি থেকে ডাটা নেওয়া ভালো

        if (!email) {
          return res
            .status(400)
            .json({ success: false, message: "Email is required" });
        }

        // ১. ৬ ডিজিটের একটি র্যান্ডম OTP তৈরি করা হলো
        const otp = Math.floor(100000 + Math.random() * 900000);

        // ২. ইমেইলের বডি ও প্রিমিয়াম ডিজাইন টেমপ্লেট
        const mailOptions = {
          from: `"RecipeHub Community" <${process.env.EMAIL_USER}>`,
          to: email,
          subject: "Your RecipeHub Verification Code",
          html: `
        <div style="font-family: sans-serif; background-color: #0c0604; color: #ffffff; padding: 40px; border-radius: 20px; max-width: 500px; margin: auto; text-align: center; border: 1px solid rgba(255,255,255,0.1);">
          <p style="color: #ff6d33; font-weight: bold; letter-spacing: 3px; text-transform: uppercase; margin-bottom: 10px; font-size: 12px;">RecipeHub</p>
          <h1 style="margin-top: 0; font-size: 24px; color: #fff;">Welcome to the Kitchen, Chef ${name || "User"}!</h1>
          <p style="color: #cdb7aa; font-size: 14px; line-height: 1.5;">Thank you for joining our community. Use the verification code below to complete your registration.</p>
          <div style="background-color: #1a0f0c; border: 1px solid #ff6d33; padding: 15px 30px; display: inline-block; border-radius: 12px; margin: 25px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #ff6d33; font-family: monospace;">${otp}</span>
          </div>
          <p style="color: #7a6a60; font-size: 12px; margin-top: 20px;">This code is valid for 5 minutes. If you did not request this, please ignore this email.</p>
        </div>
      `,
        };

        // ৩. ইমেইল পাঠানো হচ্ছে
        await transporter.sendMail(mailOptions);

        // এখানে আপনি চাইলে OTP-টি আপনার ডাটাবেসের 'otps' নামক কালেকশনে সেভ করে রাখতে পারেন পরবর্তী ভেরিফিকেশনের জন্য

        res
          .status(200)
          .json({ success: true, message: "OTP sent successfully!", otp });
      } catch (error) {
        console.error("Email send error:", error);
        res.status(500).json({
          success: false,
          message: "Failed to send OTP",
          error: error.message,
        });
      }
    });

    // await client.db("admin").command({ ping: 1 });
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
