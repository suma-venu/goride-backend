
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const supabase = require("./config/supabase");
const requireAuth = require("./middleware/auth");


const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

async function getProfileRole(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data?.role ?? null;
}

// Test route
app.get("/", (req, res) => {
  res.json({ message: "GoRide backend is running!" });
});

// Database health check
app.get("/api/health/database", async (req, res) => {
  try {
    const { error } = await supabase
      .from("profiles")
      .select("id")
      .limit(1);

    if (error) throw error;

    return res.json({
      message: "GoRide backend can query Supabase.",
    });
  } catch (error) {
    console.error("Database check failed:", error.message);
    return res.status(500).json({
      message: "Database connection check failed.",
    });
  }
});

// Get or create profile
app.get("/api/profile", requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;

    const { data: existingProfile, error: lookupError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (lookupError) throw lookupError;

    if (existingProfile) {
      return res.json({ profile: existingProfile });
    }

    const { data: newProfile, error: insertError } = await supabase
      .from("profiles")
      .insert({
        id: userId,
        role: "rider",
      })
      .select()
      .single();

    if (insertError) throw insertError;

    return res.status(201).json({ profile: newProfile });
  } catch (error) {
    console.error("Profile retrieval failed:", error.message);
    return res.status(500).json({
      message: "Could not retrieve or create profile.",
    });
  }
});

// Update profile
app.patch("/api/profile", requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;
    const { full_name, phone } = req.body;

    if (
      typeof full_name !== "string" ||
      typeof phone !== "string" ||
      !full_name.trim() ||
      !phone.trim()
    ) {
      return res.status(400).json({
        message: "Please provide your full name and phone number.",
      });
    }

    const { data, error } = await supabase
      .from("profiles")
      .update({
        full_name: full_name.trim(),
        phone: phone.trim(),
      })
      .eq("id", userId)
      .select("id, full_name, phone, role")
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        message: "Profile not found. Load your profile before updating it.",
      });
    }

    return res.json({
      message: "Profile updated successfully.",
      profile: data,
    });
  } catch (error) {
    console.error("Profile update failed:", error.message);
    return res.status(500).json({
      message: "Could not update your profile.",
    });
  }
});

// Create ride request
app.post("/api/rides", requireAuth, async (req, res) => {
  try {
    const riderId = req.auth.userId;
    const role = await getProfileRole(riderId);

if (role !== "rider") {
  return res.status(403).json({
    message: "Only riders can book rides.",
  });
}
    const { pickup_location, dropoff_location, ride_type, distance_km } =
      req.body;

    const allowedRideTypes = [
      "GoRide Economy",
      "GoRide Comfort",
      "GoRide XL",
    ];

    if (
      typeof pickup_location !== "string" ||
      typeof dropoff_location !== "string" ||
      !pickup_location.trim() ||
      !dropoff_location.trim()
    ) {
      return res.status(400).json({
        message: "Pickup and drop-off locations are required.",
      });
    }

    if (!allowedRideTypes.includes(ride_type)) {
      return res.status(400).json({
        message: "Please select a valid ride type.",
      });
    }

    if (
      typeof distance_km !== "number" ||
      !Number.isFinite(distance_km) ||
      distance_km <= 0 ||
      distance_km > 1000
    ) {
      return res.status(400).json({
        message: "Please provide a valid route distance.",
      });
    }

    const multiplier =
      ride_type === "GoRide Comfort"
        ? 1.5
        : ride_type === "GoRide XL"
          ? 1.8
          : 1;

    // Demonstration pricing.
    const fare = Math.round((40 + distance_km * 15) * multiplier);

    const { data, error } = await supabase
      .from("rides")
      .insert({
        rider_id: riderId,
        pickup_location: pickup_location.trim(),
        dropoff_location: dropoff_location.trim(),
        ride_type,
        fare,
        status: "requested",
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({
      message: "Ride requested successfully.",
      ride: data,
    });
  } catch (error) {
    console.error("Ride creation failed:", error.message);
    return res.status(500).json({
      message: "Could not create your ride request.",
    });
  }
});

// Assign the first available driver to a requested ride
app.post("/api/rides/:id/assign-driver", requireAuth, async (req, res) => {
  let claimedDriverId = null;

  try {
    const role = await getProfileRole(req.auth.userId);

if (role !== "rider") {
  return res.status(403).json({
    message: "Only riders can request driver assignment.",
  });
}
    const rideId = Number(req.params.id);

    if (!Number.isSafeInteger(rideId) || rideId <= 0) {
      return res.status(400).json({
        message: "Invalid ride ID.",
      });
    }

    // Confirm that the ride exists and is awaiting assignment.
    const { data: ride, error: rideError } = await supabase
      .from("rides")
      .select("id, status")
      .eq("id", rideId)
      .maybeSingle();

    if (rideError) throw rideError;

    if (!ride) {
      return res.status(404).json({ message: "Ride not found." });
    }

    if (ride.status !== "requested") {
      return res.status(409).json({
        message: "Only requested rides can be assigned.",
      });
    }

 

    // Find an available driver.
    const { data: drivers, error: driverError } = await supabase
  .from("drivers")
  .select("id, profile_id, full_name, phone, vehicle_model, vehicle_number")
  .eq("is_available", true)
  .eq("status", "available")
  .limit(1);

    if (driverError) throw driverError;

    if (!drivers || drivers.length === 0) {
      return res.status(409).json({
        message: "No available drivers right now.",
      });
    }

    const driver = drivers[0];

    // Claim the driver only if they are still available.
    const { data: claimedDriver, error: claimError } = await supabase
      .from("drivers")
      .update({
        is_available: false,
        status: "on_trip",
      })
      .eq("id", driver.id)
      .eq("is_available", true)
      .eq("status", "available")
      .select("id, profile_id, full_name, phone, vehicle_model, vehicle_number")
      .maybeSingle();

    if (claimError) throw claimError;

    if (!claimedDriver) {
      return res.status(409).json({
        message: "Driver was just assigned elsewhere. Please try again.",
      });
    }

    claimedDriverId = claimedDriver.id;

    // Assign the driver only if the ride is still requested.
  const { data: updatedRide, error: updateError } = await supabase
  .from("rides")
  .update({
    status: "assigned",
    driver_id: claimedDriver.profile_id,
  })
      .eq("id", rideId)
      .eq("status", "requested")
      .select()
      .maybeSingle();

    if (updateError) throw updateError;

    if (!updatedRide) {
      await supabase
        .from("drivers")
        .update({
          is_available: true,
          status: "available",
        })
        .eq("id", claimedDriver.id);

      claimedDriverId = null;

      return res.status(409).json({
        message: "Ride was already assigned. Please refresh and try again.",
      });
    }

    return res.json({
      message: "Driver assigned successfully.",
      ride: updatedRide,
      driver: claimedDriver,
    });
  } catch (error) {
    console.error("Driver assignment failed:", error.message);

    // Release the driver if an unexpected error occurs after claiming them.
    if (claimedDriverId) {
      const { error: releaseError } = await supabase
        .from("drivers")
        .update({
          is_available: true,
          status: "available",
        })
        .eq("id", claimedDriverId);

      if (releaseError) {
        console.error("Could not release driver:", releaseError.message);
      }
    }

    return res.status(500).json({
      message: "Could not assign a driver.",
    });
  }
});

// Complete an assigned ride
app.patch("/api/rides/:id/complete", requireAuth, async (req, res) => {
  try {
    const rideId = Number(req.params.id);

    if (!Number.isSafeInteger(rideId) || rideId <= 0) {
      return res.status(400).json({ message: "Invalid ride ID." });
    }

    const { data: ride, error: rideError } = await supabase
      .from("rides")
      .select("id, status, driver_id")
      .eq("id", rideId)
      .maybeSingle();

    if (rideError) throw rideError;

    if (!ride) {
      return res.status(404).json({ message: "Ride not found." });
    }

    if (ride.status !== "assigned") {
      return res.status(409).json({
        message: "Only assigned rides can be completed.",
      });
    }

    if (ride.driver_id !== req.auth.userId) {
  return res.status(403).json({
    message: "You are not authorized to complete this ride.",
  });
}

    const { data: completedRide, error: updateError } = await supabase
      .from("rides")
      .update({ status: "completed" })
      .eq("id", rideId)
      .eq("status", "assigned")
      .select()
      .maybeSingle();

    if (updateError) throw updateError;

    if (!completedRide) {
      return res.status(409).json({
        message: "Ride status changed. Refresh and try again.",
      });
    }

    // Make the assigned driver available again.
    const { error: driverError } = await supabase
      .from("drivers")
      .update({
        is_available: true,
        status: "available",
      })
      .eq("profile_id", ride.driver_id);

    if (driverError) throw driverError;

    return res.json({
      message: "Ride completed successfully.",
      ride: completedRide,
    });
  } catch (error) {
    console.error("Ride completion failed:", error.message);

    return res.status(500).json({
      message: "Could not complete the ride.",
    });
  }
});

// Get rides assigned to the signed-in driver
app.get("/api/driver/rides", requireAuth, async (req, res) => {
  try {
    const driverId = req.auth.userId;

    if (!driverId) {
      return res.status(401).json({ message: "Please sign in again." });
    }

    const { data: rides, error } = await supabase
      .from("rides")
      .select("id, pickup_location, dropoff_location, status, driver_id")
      .eq("driver_id", driverId)
      .in("status", ["assigned", "in_progress", "completed"])
      .order("id", { ascending: false });

    if (error) throw error;

    return res.json({ rides });
  } catch (error) {
    console.error("Fetching driver rides failed:", error.message);
    return res.status(500).json({
      message: "Could not load driver rides.",
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
