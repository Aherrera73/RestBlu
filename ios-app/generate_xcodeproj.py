"""Regenera el proyecto Xcode sin dependencias externas (Python 3)."""
from hashlib import sha1
from pathlib import Path

root = Path(__file__).resolve().parent
sources = sorted(path.name for path in (root / "RestBlu").glob("*.swift"))
target = root / "RestBlu.xcodeproj"
target.mkdir(exist_ok=True)


def uid(value):
    return sha1(value.encode()).hexdigest()[:24].upper()


def entry(key, body, comment=""):
    return f"\t\t{uid(key)} /* {comment or key} */ = {{ {body} }};\n"


project = uid("project")
app = uid("target")
main = uid("main-group")
src_group = uid("source-group")
products = uid("products-group")
product = uid("product")
sources_phase = uid("sources-phase")
resources_phase = uid("resources-phase")
project_configs = uid("project-configurations")
target_configs = uid("target-configurations")
project_debug = uid("project-debug")
project_release = uid("project-release")
target_debug = uid("target-debug")
target_release = uid("target-release")

build_files = "".join(entry(f"build-{name}",
    f"isa = PBXBuildFile; fileRef = {uid('file-' + name)} /* {name} */;", name) for name in sources)
file_refs = "".join(entry(f"file-{name}",
    f"isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {name}; sourceTree = \"<group>\";", name)
    for name in sources)
file_refs += entry("info-plist", "isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = \"<group>\";", "Info.plist")
file_refs += entry("assets", "isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = Assets.xcassets; sourceTree = \"<group>\";", "Assets.xcassets")
file_refs += entry("product", "isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = RestBlu.app; sourceTree = BUILT_PRODUCTS_DIR;", "RestBlu.app")

source_children = ", ".join(f"{uid('file-' + name)} /* {name} */" for name in sources)
source_children += f", {uid('info-plist')} /* Info.plist */, {uid('assets')} /* Assets.xcassets */"
build_children = ", ".join(f"{uid('build-' + name)} /* {name} */" for name in sources)

objects = []
objects.append("/* Begin PBXBuildFile section */\n" + build_files + "/* End PBXBuildFile section */\n")
objects.append("/* Begin PBXBuildFile resources section */\n" + entry("assets-build", f"isa = PBXBuildFile; fileRef = {uid('assets')} /* Assets.xcassets */;", "Assets.xcassets") + "/* End PBXBuildFile resources section */\n")
objects.append("/* Begin PBXFileReference section */\n" + file_refs + "/* End PBXFileReference section */\n")
objects.append("/* Begin PBXGroup section */\n" +
    entry("main-group", f"isa = PBXGroup; children = ({src_group} /* RestBlu */, {products} /* Products */); sourceTree = \"<group>\";", "Main Group") +
    entry("source-group", f"isa = PBXGroup; children = ({source_children}); path = RestBlu; sourceTree = \"<group>\";", "RestBlu") +
    entry("products-group", f"isa = PBXGroup; children = ({product} /* RestBlu.app */); name = Products; sourceTree = \"<group>\";", "Products") +
    "/* End PBXGroup section */\n")
objects.append("/* Begin PBXNativeTarget section */\n" +
    entry("target", f"isa = PBXNativeTarget; buildConfigurationList = {target_configs} /* Configurations */; buildPhases = ({sources_phase} /* Sources */, {resources_phase} /* Resources */); buildRules = (); dependencies = (); name = RestBlu; productName = RestBlu; productReference = {product} /* RestBlu.app */; productType = \"com.apple.product-type.application\";", "RestBlu") +
    "/* End PBXNativeTarget section */\n")
objects.append("/* Begin PBXProject section */\n" +
    entry("project", f"isa = PBXProject; attributes = {{ BuildIndependentTargetsInParallel = YES; LastUpgradeCheck = 1500; TargetAttributes = {{ {app} = {{ CreatedOnToolsVersion = 15.0; }}; }}; }}; buildConfigurationList = {project_configs} /* Configurations */; compatibilityVersion = \"Xcode 15.0\"; developmentRegion = es; hasScannedForEncodings = 0; knownRegions = (es, en, Base); mainGroup = {main} /* Main Group */; productRefGroup = {products} /* Products */; projectDirPath = \"\"; projectRoot = \"\"; targets = ({app} /* RestBlu */);", "Project object") +
    "/* End PBXProject section */\n")
objects.append("/* Begin PBXSourcesBuildPhase section */\n" +
    entry("sources-phase", f"isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ({build_children}); runOnlyForDeploymentPostprocessing = 0;", "Sources") +
    "/* End PBXSourcesBuildPhase section */\n")
objects.append("/* Begin PBXResourcesBuildPhase section */\n" +
    entry("resources-phase", f"isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = ({uid('assets-build')} /* Assets.xcassets */); runOnlyForDeploymentPostprocessing = 0;", "Resources") +
    "/* End PBXResourcesBuildPhase section */\n")

project_base = "ALWAYS_SEARCH_USER_PATHS = NO; CLANG_ENABLE_MODULES = YES; SDKROOT = iphoneos; IPHONEOS_DEPLOYMENT_TARGET = 17.0;"
target_base = "ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon; ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS = NO; CODE_SIGN_STYLE = Automatic; CURRENT_PROJECT_VERSION = 1; GENERATE_INFOPLIST_FILE = NO; INFOPLIST_FILE = RestBlu/Info.plist; IPHONEOS_DEPLOYMENT_TARGET = 17.0; MARKETING_VERSION = 1.0; PRODUCT_BUNDLE_IDENTIFIER = cl.restblu.huesped.ios; PRODUCT_NAME = RestBlu; SUPPORTED_PLATFORMS = \"iphoneos iphonesimulator\"; SWIFT_VERSION = 5.0; TARGETED_DEVICE_FAMILY = 1;"
configs = [
    ("project-debug", "Debug", project_base + " DEBUG_INFORMATION_FORMAT = dwarf; SWIFT_OPTIMIZATION_LEVEL = \"-Onone\";"),
    ("project-release", "Release", project_base + " DEBUG_INFORMATION_FORMAT = \"dwarf-with-dsym\"; SWIFT_OPTIMIZATION_LEVEL = \"-O\";"),
    ("target-debug", "Debug", target_base + " SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG;"),
    ("target-release", "Release", target_base),
]
objects.append("/* Begin XCBuildConfiguration section */\n" +
    "".join(entry(key, f"isa = XCBuildConfiguration; buildSettings = {{ {settings} }}; name = {name};", name)
            for key, name, settings in configs) + "/* End XCBuildConfiguration section */\n")
objects.append("/* Begin XCConfigurationList section */\n" +
    entry("project-configurations", f"isa = XCConfigurationList; buildConfigurations = ({project_debug} /* Debug */, {project_release} /* Release */); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;", "Project configurations") +
    entry("target-configurations", f"isa = XCConfigurationList; buildConfigurations = ({target_debug} /* Debug */, {target_release} /* Release */); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;", "Target configurations") +
    "/* End XCConfigurationList section */\n")

content = ("// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tclasses = {};\n\tobjectVersion = 60;\n\tobjects = {\n" +
           "\n".join(objects) + f"\t}};\n\trootObject = {project} /* Project object */;\n}}\n")
(target / "project.pbxproj").write_text(content, encoding="utf-8")
print(f"Generated {target / 'project.pbxproj'} with {len(sources)} Swift files")
